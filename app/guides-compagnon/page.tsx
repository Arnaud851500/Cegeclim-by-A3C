'use client'

// ============================================================================
// app/guides-compagnon/page.tsx — Guide utilisateur « Mon Compagnon » (15/11/2026)
// ----------------------------------------------------------------------------
// Pendant du guide BLG (/guides-blg) pour les écrans du compagnon lui-même.
//  - Les chapitres sont des fichiers HTML autonomes rangés dans le dépôt, un dossier
//    par pavé de la page d'accueil : guides-compagnon/<id du pavé>/CHAPITRE-xxx.html
//    (id du pavé = NAV_BLOCS[].id, lib/navigation.ts) ;
//  - un pavé par bloc d'accueil ayant au moins un chapitre (mêmes couleurs, icônes et
//    libellés que l'accueil) ; un clic ouvre une fenêtre flottante avec les chapitres
//    du pavé et leurs modes opératoires ;
//  - zone de question en tête (même recherche que le guide BLG) ;
//  - lecture : page du chapitre dans une iframe isolée (srcdoc + sandbox), images
//    servies par URL signées depuis le bucket privé « guides-blg » (préfixe compagnon/).
// Publication : à l'ouverture de la page par un administrateur, la route
// /api/admin/guides-compagnon liste les fichiers du dépôt avec leur empreinte ; les
// fichiers nouveaux ou modifiés sont publiés par le navigateur avec le traitement des
// guides BLG (lib/guidesBlg.ts : extraction des images, page légère, sommaire) ; un
// chapitre dont le fichier a été retiré du dépôt est retiré du guide.
// Droits : lecture can_guides_blg (ou administration), publication réservée aux
// administrateurs (peut_lire_guides_blg / peut_gerer_guides_blg).
// URL : ?chapitre=<slug>&ancre=<id d'étape ou de mode opératoire>
// Migration : 20261115a_guides_compagnon.sql
// ============================================================================

import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { themed, tc } from '@/lib/theme'
import { NAV_BLOCS, type NavBloc } from '@/lib/navigation'
import {
  GUIDES_BUCKET,
  GUIDES_URL_TTL,
  assetsReferences,
  construireGuide,
  formatTaille,
  indexerGuide,
  preparerGuide,
  rechercherModops,
  slugDepuisFichier,
  type GuideModopIndex,
  type GuideSommaireItem,
  type ResultatRecherche,
} from '@/lib/guidesBlg'

const TABLE = 'guides_compagnon'
const PREFIXE_STOCKAGE = 'compagnon'

type GuideRow = {
  slug: string
  bloc: string
  chemin_source: string
  titre: string
  sous_titre: string | null
  fichier_origine: string | null
  ordre: number
  version: number
  prefixe: string
  sommaire: GuideSommaireItem[] | null
  nb_modop: number
  nb_etapes: number
  nb_images: number
  nb_pdf: number
  taille_origine: number | null
  taille_page: number | null
  actif: boolean
  icone: string | null
  source_hash: string | null
  updated_at: string
  updated_by: string | null
}

type FichierDepot = { chemin: string; bloc: string; fichier: string; taille: number; hash: string }
type IndexGuide = { prefixe: string; modops: GuideModopIndex[] }

const EXEMPLES = ['escalader un ticket', 'vue éclatée Hi-Parts', 'demander un rappel', 'cas similaires', 'parcours de diagnostic']

/** Pavés de l'accueil pouvant porter un guide (le bloc des guides lui-même exclu). */
const BLOCS: NavBloc[] = NAV_BLOCS.filter((b) => b.id !== 'guides')
const BLOC_PAR_ID = new Map(BLOCS.map((b) => [b.id, b]))

function slugChapitre(bloc: string, fichier: string) {
  return `${bloc}--${slugDepuisFichier(fichier)}`
}

function iconeBloc(bloc: NavBloc | undefined, g?: GuideRow | null) {
  if (g?.icone && g.icone.trim()) return g.icone.trim()
  return bloc?.icon ?? '📘'
}

const s = themed({
  page: { padding: '20px 24px 40px', color: '#F5F3EC', fontFamily: '"IBM Plex Sans", system-ui, sans-serif', minHeight: '100vh', background: '#0B1220' },
  header: { display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, marginBottom: 16 },
  title: { margin: 0, fontFamily: '"Space Grotesk", system-ui, sans-serif', fontSize: 26, fontWeight: 700, letterSpacing: -0.3, color: '#ffffff' },
  subtitle: { margin: '6px 0 0', fontSize: 13, color: 'rgba(245,243,236,0.62)', maxWidth: 860, lineHeight: 1.5 },
  askBox: { borderRadius: 16, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)', padding: '16px 18px', marginBottom: 20 },
  askLabel: { fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.6, color: 'rgba(245,243,236,0.6)', fontWeight: 600, marginBottom: 8 },
  askRow: { display: 'flex', gap: 10, alignItems: 'center' },
  askInput: { flex: 1, minWidth: 0, background: 'rgba(11,18,32,0.9)', color: '#F5F3EC', border: '1px solid rgba(166,161,129,0.55)', borderRadius: 12, padding: '13px 16px', fontSize: 16 },
  examples: { display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10, alignItems: 'center' },
  example: { fontSize: 12, padding: '4px 10px', borderRadius: 999, background: 'rgba(166,161,129,0.16)', color: '#E8E4D2', border: 'none', cursor: 'pointer' },
  results: { display: 'flex', flexDirection: 'column', gap: 6, marginTop: 14 },
  result: { display: 'flex', gap: 14, alignItems: 'center', padding: '10px 14px', borderRadius: 12, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', cursor: 'pointer' },
  resultIcon: { fontSize: 28, width: 40, textAlign: 'center', flexShrink: 0 },
  resultTitle: { fontSize: 15, fontWeight: 600, color: '#ffffff' },
  resultMeta: { fontSize: 12, color: 'rgba(245,243,236,0.6)', marginTop: 2 },
  resultStep: { fontSize: 12, color: '#8FC7DA', marginTop: 3 },
  tiles: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 16 },
  tile: { position: 'relative', borderRadius: 18, padding: '22px 18px 18px', minHeight: 200, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 8, cursor: 'pointer', color: '#ffffff', border: '1px solid rgba(255,255,255,0.10)', boxShadow: '0 6px 18px rgba(0,0,0,0.25)', textAlign: 'left' },
  tileIcons: { display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 },
  tileIcon: { fontSize: 30, lineHeight: 1, width: 54, height: 54, borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  tileTitle: { fontFamily: '"Space Grotesk", system-ui, sans-serif', fontSize: 21, fontWeight: 700, color: '#ffffff', margin: 0 },
  tileSub: { fontSize: 12, color: 'rgba(255,255,255,0.78)' },
  tileBadge: { position: 'absolute', top: 12, right: 12, fontSize: 11, padding: '3px 9px', borderRadius: 999, background: 'rgba(224,122,78,0.85)', color: '#ffffff', fontWeight: 600 },
  sectionTitle: { fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.6, color: 'rgba(245,243,236,0.6)', fontWeight: 600, margin: '26px 0 12px' },
  overlay: { position: 'fixed', inset: 0, zIndex: 900, background: 'rgba(5,9,18,0.72)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '5vh 2vw', overflowY: 'auto' },
  modal: { width: 'min(1180px, 96vw)', borderRadius: 18, background: '#101A2E', border: '1px solid rgba(255,255,255,0.14)', boxShadow: '0 20px 60px rgba(0,0,0,0.5)', overflow: 'hidden' },
  modalHead: { display: 'flex', alignItems: 'center', gap: 16, padding: '18px 22px', color: '#ffffff' },
  modalIcon: { fontSize: 40, width: 64, height: 64, borderRadius: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  modalTitle: { margin: 0, fontFamily: '"Space Grotesk", system-ui, sans-serif', fontSize: 24, fontWeight: 700, color: '#ffffff' },
  chapitre: { padding: '14px 22px 4px', borderTop: '1px solid rgba(255,255,255,0.08)' },
  chapitreHead: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginBottom: 10 },
  chapitreTitre: { fontFamily: '"Space Grotesk", system-ui, sans-serif', fontSize: 18, fontWeight: 700, color: '#ffffff' },
  modops: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(460px, 1fr))', gap: 10, paddingBottom: 14 },
  modop: { display: 'flex', gap: 14, alignItems: 'flex-start', padding: '12px 14px', borderRadius: 12, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', cursor: 'pointer' },
  modopNum: { fontSize: 11, color: '#A6A181', fontWeight: 700, letterSpacing: 0.4, minWidth: 82, paddingTop: 3, whiteSpace: 'nowrap' },
  modopTitle: { fontSize: 15, fontWeight: 600, color: '#ffffff', lineHeight: 1.35 },
  modopResume: { fontSize: 12.5, color: 'rgba(245,243,236,0.62)', marginTop: 4, lineHeight: 1.45 },
  modopCount: { marginLeft: 'auto', fontSize: 12, color: 'rgba(245,243,236,0.55)', whiteSpace: 'nowrap', paddingTop: 2 },
  muted: { fontSize: 12, color: 'rgba(245,243,236,0.5)' },
  btn: { background: 'rgba(255,255,255,0.08)', color: '#F5F3EC', border: '1px solid rgba(255,255,255,0.16)', borderRadius: 8, padding: '7px 12px', fontSize: 13, cursor: 'pointer' },
  btnPrimary: { background: '#A6A181', color: '#0B1220', border: '1px solid #A6A181', borderRadius: 8, padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  btnClose: { background: 'rgba(255,255,255,0.14)', color: '#ffffff', border: 'none', borderRadius: 10, width: 38, height: 38, fontSize: 20, cursor: 'pointer', flexShrink: 0 },
  error: { padding: '12px 14px', borderRadius: 10, background: 'rgba(193,104,60,0.15)', border: '1px solid rgba(193,104,60,0.5)', color: '#E07A4E', marginBottom: 16, fontSize: 13 },
  info: { padding: '10px 14px', borderRadius: 10, background: 'rgba(143,199,218,0.10)', border: '1px solid rgba(143,199,218,0.35)', color: '#8FC7DA', marginBottom: 16, fontSize: 13 },
  readerBar: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginBottom: 10 },
  select: { background: 'rgba(11,18,32,0.9)', color: '#F5F3EC', border: '1px solid rgba(255,255,255,0.16)', borderRadius: 8, padding: '7px 10px', fontSize: 13, maxWidth: 420 },
  frameWrap: { borderRadius: 12, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.12)', background: '#EFEFEA' },
  loading: { padding: 40, textAlign: 'center', color: '#78817D', fontSize: 14 },
})

export default function GuidesCompagnonPage() {
  return (
    <Suspense fallback={<div style={s.page}>Chargement…</div>}>
      <GuidesCompagnonContent />
    </Suspense>
  )
}

async function chargerIndex(prefixe: string): Promise<GuideModopIndex[]> {
  const { data, error } = await supabase.storage.from(GUIDES_BUCKET).download(`${prefixe}/index.html`)
  if (error || !data) return []
  return indexerGuide(await data.text())
}

async function viderDossier(prefixe: string) {
  const bucket = supabase.storage.from(GUIDES_BUCKET)
  for (;;) {
    const { data } = await bucket.list(prefixe, { limit: 1000 })
    const paths = (data ?? []).filter((o) => o.name).map((o) => `${prefixe}/${o.name}`)
    if (!paths.length) break
    const { error } = await bucket.remove(paths)
    if (error || paths.length < 1000) break
  }
}

function GuidesCompagnonContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const chapitre = searchParams.get('chapitre')
  const ancre = searchParams.get('ancre')

  const [guides, setGuides] = useState<GuideRow[]>([])
  const [loading, setLoading] = useState(true)
  const [gestion, setGestion] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const [blocOuvert, setBlocOuvert] = useState<string | null>(null)
  const [question, setQuestion] = useState('')
  const [indexes, setIndexes] = useState<Map<string, IndexGuide>>(new Map())
  const [indexation, setIndexation] = useState(false)
  const enCours = useRef<Set<string>>(new Set())
  const synchroFaite = useRef(false)

  const naviguer = useCallback(
    (slug: string | null, a?: string | null) => {
      const p = new URLSearchParams()
      if (slug) p.set('chapitre', slug)
      if (slug && a) p.set('ancre', a)
      const qs = p.toString()
      router.push(qs ? `/guides-compagnon?${qs}` : '/guides-compagnon', { scroll: true })
    },
    [router],
  )

  // Catalogue + droit de publication
  useEffect(() => {
    let active = true
    void (async () => {
      const [{ data, error: err }, droit] = await Promise.all([
        supabase.from(TABLE).select('*').order('ordre', { ascending: true }).order('titre', { ascending: true }),
        supabase.rpc('peut_gerer_guides_blg'),
      ])
      if (!active) return
      if (err) setError(`Lecture du guide : ${err.message}`)
      setGuides(((data ?? []) as GuideRow[]).map((g) => ({ ...g, sommaire: Array.isArray(g.sommaire) ? g.sommaire : [] })))
      setGestion(Boolean(droit.data))
      setLoading(false)
    })()
    return () => {
      active = false
    }
  }, [tick])

  // ── Publication depuis le dépôt (administrateurs) ─────────────────────────
  const publier = useCallback(async (f: FichierDepot, existant: GuideRow | null, ordre: number, auteur: string | null) => {
    setBusy(`${f.chemin} : lecture du fichier…`)
    const res = await fetch('/api/admin/guides-compagnon', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chemin: f.chemin }),
    })
    const rep = (await res.json().catch(() => ({}))) as { path?: string; hash?: string; message?: string }
    if (!res.ok || !rep.path) throw new Error(rep.message ?? `HTTP ${res.status}`)

    const bucket = supabase.storage.from(GUIDES_BUCKET)
    try {
      const { data: blob, error: dlErr } = await bucket.download(rep.path)
      if (dlErr || !blob) throw new Error(dlErr?.message ?? 'fichier temporaire introuvable')
      const file = new File([blob], f.fichier, { type: 'text/html' })
      setBusy(`${f.chemin} : préparation…`)
      const prep = await preparerGuide(file)
      const slug = slugChapitre(f.bloc, f.fichier)
      const version = (existant?.version ?? 0) + 1
      const prefixe = `${PREFIXE_STOCKAGE}/${slug}/v${version}`

      let envoyes = 0
      const queue = [...prep.assets]
      const worker = async () => {
        for (let a = queue.shift(); a; a = queue.shift()) {
          const { error: upErr } = await bucket.upload(`${prefixe}/${a.nom}`, a.blob, { contentType: a.mime, upsert: true, cacheControl: '31536000' })
          if (upErr) throw new Error(`${a.nom} : ${upErr.message}`)
          envoyes++
          setBusy(`${f.chemin} : envoi des images ${envoyes}/${prep.assets.length}…`)
        }
      }
      await Promise.all(Array.from({ length: 6 }, () => worker()))

      const page = new Blob([prep.html], { type: 'text/plain;charset=utf-8' })
      const { error: pageErr } = await bucket.upload(`${prefixe}/index.html`, page, { contentType: 'text/plain;charset=utf-8', upsert: true, cacheControl: '60' })
      if (pageErr) throw new Error(`page : ${pageErr.message}`)

      const { error: rowErr } = await supabase.from(TABLE).upsert(
        {
          slug,
          bloc: f.bloc,
          chemin_source: f.chemin,
          titre: prep.titre,
          sous_titre: prep.sous_titre || null,
          fichier_origine: f.fichier,
          ordre: existant?.ordre ?? ordre,
          version,
          prefixe,
          sommaire: prep.sommaire,
          nb_modop: prep.nb_modop,
          nb_etapes: prep.nb_etapes,
          nb_images: prep.nb_images,
          nb_pdf: prep.nb_pdf,
          taille_origine: prep.taille_origine,
          taille_page: prep.taille_page,
          actif: existant?.actif ?? true,
          icone: existant?.icone ?? null,
          source_hash: rep.hash ?? f.hash,
          updated_at: new Date().toISOString(),
          updated_by: auteur,
        },
        { onConflict: 'slug' },
      )
      if (rowErr) throw new Error(`catalogue : ${rowErr.message}`)
      if (existant?.prefixe && existant.prefixe !== prefixe) await viderDossier(existant.prefixe)
      return `${prep.titre} (${prep.nb_modop} modes opératoires, ${prep.nb_etapes} étapes)`
    } finally {
      await bucket.remove([rep.path])
    }
  }, [])

  const synchroniser = useCallback(
    async (liste: GuideRow[], force = false) => {
      setError(null)
      setMessage(null)
      setBusy('Lecture des chapitres du dépôt…')
      try {
        const res = await fetch('/api/admin/guides-compagnon')
        const rep = (await res.json().catch(() => ({}))) as { fichiers?: FichierDepot[]; message?: string }
        if (!res.ok || !Array.isArray(rep.fichiers)) throw new Error(rep.message ?? `HTTP ${res.status}`)
        const fichiers = rep.fichiers
        const parChemin = new Map(liste.map((g) => [g.chemin_source, g]))
        const { data: userData } = await supabase.auth.getUser()
        const auteur = userData.user?.email ?? null
        const faits: string[] = []
        const erreurs: string[] = []
        let ordre = liste.reduce((m, g) => Math.max(m, g.ordre ?? 0), 0)

        for (const f of fichiers) {
          const existant = parChemin.get(f.chemin) ?? null
          if (!force && existant && existant.source_hash === f.hash) continue
          if (!existant) ordre += 10
          try {
            faits.push(await publier(f, existant, ordre, auteur))
          } catch (e) {
            erreurs.push(`${f.chemin} : ${e instanceof Error ? e.message : String(e)}`)
          }
        }

        // Chapitre dont le fichier a été retiré du dépôt → retiré du guide
        // (seulement si la liste du dépôt a bien été lue et n'est pas vide).
        const presents = new Set(fichiers.map((f) => f.chemin))
        const retires = fichiers.length ? liste.filter((g) => !presents.has(g.chemin_source)) : []
        for (const g of retires) {
          const { error: delErr } = await supabase.from(TABLE).delete().eq('slug', g.slug)
          if (delErr) erreurs.push(`${g.chemin_source} : ${delErr.message}`)
          else {
            await viderDossier(g.prefixe)
            faits.push(`${g.titre} retiré (fichier supprimé du dépôt)`)
          }
        }

        if (erreurs.length) setError(`Publication du guide : ${erreurs.join(' · ')}`)
        if (faits.length) {
          setMessage(`Guide mis à jour depuis le dépôt : ${faits.join(' · ')}.`)
          setTick((n) => n + 1)
        }
      } catch (e) {
        setError(`Publication du guide : ${e instanceof Error ? e.message : String(e)}`)
      } finally {
        setBusy(null)
      }
    },
    [publier],
  )

  // Publication automatique, une fois par visite, quand un administrateur ouvre le catalogue.
  useEffect(() => {
    if (loading || !gestion || chapitre || synchroFaite.current) return
    synchroFaite.current = true
    void synchroniser(guides)
  }, [loading, gestion, chapitre, guides, synchroniser])

  // ── Catalogue ──────────────────────────────────────────────────────────────
  const visibles = useMemo(() => guides.filter((g) => g.actif || gestion), [guides, gestion])
  const lisibles = useMemo(() => guides.filter((g) => g.actif), [guides])
  const courant = useMemo(() => (chapitre ? guides.find((g) => g.slug === chapitre) ?? null : null), [guides, chapitre])

  const parBloc = useMemo(() => {
    const m = new Map<string, GuideRow[]>()
    for (const g of visibles) {
      const l = m.get(g.bloc) ?? []
      l.push(g)
      m.set(g.bloc, l)
    }
    return m
  }, [visibles])

  // Ordre de l'accueil, puis dossiers inconnus de l'arborescence (pavé renommé…).
  const blocsAvecGuide = useMemo(() => {
    const connus = BLOCS.filter((b) => parBloc.has(b.id))
    const inconnus = Array.from(parBloc.keys())
      .filter((id) => !BLOC_PAR_ID.has(id))
      .map<NavBloc>((id) => ({ id, label: id, subtitle: '', icon: '📘', gradient: ['#2E6E66', '#173C3A'], iconBg: 'rgba(255,255,255,0.18)', pages: [] }))
    return [...connus, ...inconnus]
  }, [parBloc])

  const blocsSansGuide = useMemo(() => BLOCS.filter((b) => !parBloc.has(b.id)), [parBloc])

  const indexer = useCallback(
    async (liste: GuideRow[]) => {
      const manquants = liste.filter((g) => indexes.get(g.slug)?.prefixe !== g.prefixe && !enCours.current.has(g.prefixe))
      if (!manquants.length) return
      manquants.forEach((g) => enCours.current.add(g.prefixe))
      setIndexation(true)
      const faits = await Promise.all(manquants.map(async (g) => [g.slug, { prefixe: g.prefixe, modops: await chargerIndex(g.prefixe) }] as const))
      setIndexes((prev) => {
        const next = new Map(prev)
        faits.forEach(([slug, idx]) => next.set(slug, idx))
        return next
      })
      manquants.forEach((g) => enCours.current.delete(g.prefixe))
      setIndexation(false)
    },
    [indexes],
  )

  useEffect(() => {
    if (question.trim().length >= 2) void indexer(lisibles)
  }, [question, lisibles, indexer])

  const guidesBlocOuvert = useMemo(() => (blocOuvert ? parBloc.get(blocOuvert) ?? [] : []), [blocOuvert, parBloc])
  useEffect(() => {
    if (guidesBlocOuvert.length) void indexer(guidesBlocOuvert)
  }, [guidesBlocOuvert, indexer])

  const resultats: ResultatRecherche[] = useMemo(() => {
    if (question.trim().length < 2) return []
    const corpus = lisibles
      .map((g) => ({ slug: g.slug, titre: g.titre, icone: iconeBloc(BLOC_PAR_ID.get(g.bloc), g), modops: indexes.get(g.slug)?.modops ?? [] }))
      .filter((g) => g.modops.length)
    return rechercherModops(question, corpus, 8)
  }, [question, lisibles, indexes])

  useEffect(() => {
    if (!blocOuvert) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setBlocOuvert(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [blocOuvert])

  const basculerActif = async (g: GuideRow) => {
    const { error: err } = await supabase.from(TABLE).update({ actif: !g.actif }).eq('slug', g.slug)
    if (err) setError(err.message)
    setTick((n) => n + 1)
  }

  // ── Lecture ──────────────────────────────────────────────────────────────
  if (chapitre) {
    return (
      <div style={s.page}>
        {error && <div style={s.error}>{error}</div>}
        {loading ? (
          <div style={s.muted}>Chargement…</div>
        ) : courant ? (
          <Lecteur guide={courant} ancre={ancre} onRetour={() => naviguer(null)} onAncre={(a) => naviguer(courant.slug, a)} />
        ) : (
          <div style={s.info}>
            Ce chapitre n’existe pas ou n’est plus publié.{' '}
            <button type="button" style={s.btn} onClick={() => naviguer(null)}>Voir tout le guide</button>
          </div>
        )}
      </div>
    )
  }

  const q = question.trim()
  const blocInfo = blocOuvert ? BLOC_PAR_ID.get(blocOuvert) ?? blocsAvecGuide.find((b) => b.id === blocOuvert) ?? null : null

  return (
    <div style={s.page}>
      <div style={s.header}>
        <div>
          <h1 style={s.title}>Guide utilisateur — Mon Compagnon</h1>
          <p style={s.subtitle}>Le mode d’emploi des écrans du compagnon, pavé par pavé : posez votre question, ou ouvrez un pavé pour parcourir ses modes opératoires pas à pas.</p>
        </div>
        {gestion && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {busy && <span style={{ ...s.muted, color: tc('#8FC7DA') }}>{busy}</span>}
            <button
              type="button"
              style={s.btn}
              disabled={Boolean(busy)}
              onClick={() => void synchroniser(guides, true)}
              title="Republie tous les chapitres du dossier guides-compagnon du dépôt, même inchangés"
            >
              ⟳ Republier depuis le dépôt
            </button>
          </div>
        )}
      </div>

      {error && <div style={s.error}>{error}</div>}
      {message && <div style={s.info}>{message}</div>}

      <div style={s.askBox}>
        <div style={s.askLabel}>Que voulez-vous faire dans le compagnon ?</div>
        <div style={s.askRow}>
          <input
            style={s.askInput}
            value={question}
            placeholder="Ex. : comment escalader un ticket au niveau 2 ? ajouter une pièce Hi-Parts ?"
            onChange={(e) => setQuestion(e.target.value)}
            onFocus={() => void indexer(lisibles)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && resultats[0]) naviguer(resultats[0].slug, resultats[0].ancre)
              if (e.key === 'Escape') setQuestion('')
            }}
            aria-label="Question sur le compagnon"
          />
          {q && <button type="button" style={s.btn} onClick={() => setQuestion('')}>Effacer</button>}
        </div>
        {!q && (
          <div style={s.examples}>
            <span style={s.muted}>Exemples :</span>
            {EXEMPLES.map((ex) => (
              <button key={ex} type="button" style={s.example} onClick={() => setQuestion(ex)}>{ex}</button>
            ))}
          </div>
        )}
        {q.length >= 2 && (
          <div style={s.results}>
            {resultats.length === 0 ? (
              <div style={s.muted}>{indexation ? 'Lecture du guide…' : 'Aucun mode opératoire ne correspond. Essayez avec d’autres mots.'}</div>
            ) : (
              resultats.map((r) => (
                <div
                  key={`${r.slug}|${r.modop.id}`}
                  style={s.result}
                  onClick={() => naviguer(r.slug, r.ancre)}
                  onMouseEnter={(e) => (e.currentTarget.style.borderColor = tc('#A6A181'))}
                  onMouseLeave={(e) => (e.currentTarget.style.borderColor = tc('rgba(255,255,255,0.08)'))}
                >
                  <div style={s.resultIcon}>{r.icone}</div>
                  <div style={{ minWidth: 0 }}>
                    <div style={s.resultTitle}>{r.modop.titre}</div>
                    <div style={s.resultMeta}>{r.guideTitre} · {r.modop.numero} · {r.modop.etapes.length} étapes{r.modop.resume ? ` — ${r.modop.resume}` : ''}</div>
                    {r.etape && <div style={s.resultStep}>→ ouvre à l’étape {r.etape.numero} : {r.etape.titre}</div>}
                  </div>
                  <span style={{ ...s.muted, marginLeft: 'auto', whiteSpace: 'nowrap' }}>Ouvrir ›</span>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {loading ? (
        <div style={s.muted}>Chargement…</div>
      ) : blocsAvecGuide.length === 0 ? (
        <div style={s.info}>{busy ? 'Publication du guide en cours…' : 'Aucun chapitre publié pour le moment.'}</div>
      ) : (
        <div style={s.tiles}>
          {blocsAvecGuide.map((b) => {
            const liste = parBloc.get(b.id) ?? []
            const nbModop = liste.reduce((n, g) => n + (g.nb_modop || 0), 0)
            const nbEtapes = liste.reduce((n, g) => n + (g.nb_etapes || 0), 0)
            const toutMasque = liste.every((g) => !g.actif)
            const icones = b.icons && b.icons.length ? b.icons : [b.icon]
            return (
              <button
                key={b.id}
                type="button"
                style={{ ...s.tile, background: `linear-gradient(160deg, ${b.gradient[0]}, ${b.gradient[1]})`, opacity: toutMasque ? 0.55 : 1 }}
                onClick={() => setBlocOuvert(b.id)}
                onMouseEnter={(e) => (e.currentTarget.style.transform = 'translateY(-3px)')}
                onMouseLeave={(e) => (e.currentTarget.style.transform = 'none')}
              >
                {toutMasque && <span style={s.tileBadge}>Masqué</span>}
                <div style={s.tileIcons}>
                  {icones.map((ic, k) => (
                    <span key={k} style={{ ...s.tileIcon, background: b.iconBg }}>{ic}</span>
                  ))}
                </div>
                <h2 style={s.tileTitle}>{b.label}</h2>
                <div style={s.tileSub}>
                  {liste.length} chapitre{liste.length > 1 ? 's' : ''} · {nbModop} mode{nbModop > 1 ? 's' : ''} opératoire{nbModop > 1 ? 's' : ''} · {nbEtapes} étapes
                </div>
              </button>
            )
          })}
        </div>
      )}

      {!loading && gestion && blocsSansGuide.length > 0 && (
        <>
          <div style={s.sectionTitle}>Pavés sans chapitre (visible des administrateurs)</div>
          <div style={s.muted}>
            {blocsSansGuide.map((b) => `${b.icon} ${b.label} (guides-compagnon/${b.id}/)`).join(' · ')}
            <br />
            Un fichier CHAPITRE-xxx.html déposé dans le dossier du pavé, dans le dépôt GitHub, est publié ici à la prochaine ouverture de cette page par un administrateur.
          </div>
        </>
      )}

      {blocInfo && (
        <div style={s.overlay} onClick={() => setBlocOuvert(null)}>
          <div style={s.modal} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={blocInfo.label}>
            <div style={{ ...s.modalHead, background: `linear-gradient(120deg, ${blocInfo.gradient[0]}, ${blocInfo.gradient[1]})` }}>
              <div style={{ ...s.modalIcon, background: blocInfo.iconBg }}>{blocInfo.icon}</div>
              <div style={{ minWidth: 0 }}>
                <h2 style={s.modalTitle}>{blocInfo.label}</h2>
                <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.8)' }}>
                  {blocInfo.subtitle ? `${blocInfo.subtitle} · ` : ''}
                  {guidesBlocOuvert.length} chapitre{guidesBlocOuvert.length > 1 ? 's' : ''}
                </div>
              </div>
              <button type="button" style={{ ...s.btnClose, marginLeft: 'auto' }} onClick={() => setBlocOuvert(null)} aria-label="Fermer">×</button>
            </div>
            {guidesBlocOuvert.map((g) => {
              const idx = indexes.get(g.slug)
              const modops: Array<GuideSommaireItem & { resume?: string }> =
                idx?.prefixe === g.prefixe && idx.modops.length
                  ? idx.modops.map((m) => ({ id: m.id, numero: m.numero, titre: m.titre, nb_etapes: m.etapes.length, resume: m.resume }))
                  : g.sommaire ?? []
              return (
                <div key={g.slug} style={s.chapitre}>
                  <div style={s.chapitreHead}>
                    <span style={s.chapitreTitre}>{g.titre}</span>
                    {!g.actif && <span style={{ ...s.tileBadge, position: 'static' }}>Masqué</span>}
                    <span style={s.muted}>
                      {g.sous_titre ? `${g.sous_titre} · ` : ''}
                      {g.nb_modop} modes opératoires · {g.nb_etapes} étapes · MAJ {new Date(g.updated_at).toLocaleDateString('fr-FR')}
                    </span>
                    <span style={{ flex: 1 }} />
                    {gestion && (
                      <button type="button" style={s.btn} onClick={() => void basculerActif(g)}>{g.actif ? 'Masquer' : 'Publier'}</button>
                    )}
                    <button type="button" style={s.btnPrimary} onClick={() => naviguer(g.slug)}>Ouvrir le guide complet</button>
                  </div>
                  <div style={s.modops}>
                    {modops.length === 0 && <div style={s.muted}>Aucun mode opératoire détecté dans ce chapitre.</div>}
                    {modops.map((m) => (
                      <div
                        key={m.id}
                        style={s.modop}
                        onClick={() => naviguer(g.slug, m.id)}
                        onMouseEnter={(e) => (e.currentTarget.style.borderColor = tc('#A6A181'))}
                        onMouseLeave={(e) => (e.currentTarget.style.borderColor = tc('rgba(255,255,255,0.08)'))}
                      >
                        <span style={s.modopNum}>{m.numero || '—'}</span>
                        <div style={{ minWidth: 0 }}>
                          <div style={s.modopTitle}>{m.titre}</div>
                          {m.resume && <div style={s.modopResume}>{m.resume}</div>}
                        </div>
                        <span style={s.modopCount}>{m.nb_etapes} étape{m.nb_etapes > 1 ? 's' : ''} ›</span>
                      </div>
                    ))}
                  </div>
                  {gestion && (
                    <div style={{ ...s.muted, paddingBottom: 12 }}>
                      guides-compagnon/{g.chemin_source} · v{g.version} · {formatTaille(g.taille_origine)} → page {formatTaille(g.taille_page)} · {g.nb_images} images
                      {g.updated_by ? ` · ${g.updated_by}` : ''}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Lecteur (même principe que le guide BLG) ────────────────────────────────
function Lecteur({
  guide,
  ancre,
  onRetour,
  onAncre,
}: {
  guide: GuideRow
  ancre: string | null
  onRetour: () => void
  onAncre: (ancre: string | null) => void
}) {
  const [source, setSource] = useState<{ key: string; html: string | null; urls: Map<string, string>; error: string | null } | null>(null)
  const [pleinEcran, setPleinEcran] = useState(false)
  const key = `${guide.prefixe}|${guide.version}`
  const bloc = BLOC_PAR_ID.get(guide.bloc)

  useEffect(() => {
    let active = true
    void (async () => {
      const bucket = supabase.storage.from(GUIDES_BUCKET)
      const { data: blob, error: dlErr } = await bucket.download(`${guide.prefixe}/index.html`)
      if (!active) return
      if (dlErr || !blob) {
        setSource({ key, html: null, urls: new Map(), error: `Chargement du guide : ${dlErr?.message ?? 'fichier introuvable'}` })
        return
      }
      const html = await blob.text()
      const noms = assetsReferences(html)
      const urls = new Map<string, string>()
      for (let i = 0; i < noms.length; i += 200) {
        const lot = noms.slice(i, i + 200)
        const { data: signes, error: sErr } = await bucket.createSignedUrls(lot.map((n) => `${guide.prefixe}/${n}`), GUIDES_URL_TTL)
        if (sErr) {
          if (active) setSource({ key, html: null, urls, error: `Images du guide : ${sErr.message}` })
          return
        }
        ;(signes ?? []).forEach((r, j) => {
          if (r.signedUrl) urls.set(lot[j], r.signedUrl)
        })
      }
      if (active) setSource({ key, html, urls, error: null })
    })()
    return () => {
      active = false
    }
  }, [guide.prefixe, key])

  const pret = source?.key === key ? source : null
  const srcDoc = useMemo(() => (pret?.html ? construireGuide(pret.html, pret.urls, ancre) : null), [pret, ancre])

  useEffect(() => {
    if (!pleinEcran) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPleinEcran(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pleinEcran])

  const sommaire = guide.sommaire ?? []
  const modopCourant = ancre ? sommaire.find((m) => ancre === m.id || ancre.startsWith(`${m.id}-`))?.id ?? '' : ''

  const conteneur: React.CSSProperties = pleinEcran
    ? { position: 'fixed', inset: 0, zIndex: 1000, background: tc('#0B1220'), padding: 10, display: 'flex', flexDirection: 'column' }
    : { display: 'flex', flexDirection: 'column' }

  return (
    <div style={conteneur}>
      <div style={s.readerBar}>
        {!pleinEcran && <button type="button" style={s.btn} onClick={onRetour}>← Tout le guide</button>}
        <div style={{ fontFamily: '"Space Grotesk", system-ui, sans-serif', fontSize: 18, fontWeight: 700, color: tc('#ffffff') }}>
          {iconeBloc(bloc, guide)} {guide.titre}
          {guide.sous_titre && <span style={{ ...s.muted, fontWeight: 400, marginLeft: 8 }}>{guide.sous_titre}</span>}
        </div>
        <div style={{ flex: 1 }} />
        {sommaire.length > 0 && (
          <select style={s.select} value={modopCourant} onChange={(e) => onAncre(e.target.value || null)} aria-label="Aller au mode opératoire">
            <option value="">Sommaire du chapitre</option>
            {sommaire.map((m) => (
              <option key={m.id} value={m.id}>{m.numero ? `${m.numero} — ` : ''}{m.titre}</option>
            ))}
          </select>
        )}
        <button type="button" style={s.btn} onClick={() => setPleinEcran((v) => !v)}>
          {pleinEcran ? 'Quitter le plein écran (Échap)' : 'Plein écran'}
        </button>
      </div>

      {pret?.error && <div style={s.error}>{pret.error}</div>}

      <div style={{ ...s.frameWrap, ...(pleinEcran ? { flex: 1 } : {}) }}>
        {srcDoc ? (
          <iframe
            key={`${key}|${ancre ?? ''}`}
            title={guide.titre}
            srcDoc={srcDoc}
            sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads"
            style={{ width: '100%', height: pleinEcran ? '100%' : 'calc(100vh - 190px)', minHeight: 480, border: 0, display: 'block', background: '#EFEFEA' }}
          />
        ) : !pret?.error ? (
          <div style={s.loading}>Chargement du guide…</div>
        ) : null}
      </div>
    </div>
  )
}
