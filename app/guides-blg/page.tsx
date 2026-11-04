'use client'

// ============================================================================
// app/guides-blg/page.tsx — Bloc « Guides BLG » (modes opératoires BLG Cloud) — 03/11/2026
// ----------------------------------------------------------------------------
// Bibliothèque des chapitres HTML autonomes (CHAPITRE-Clients.html…) :
//  - zone de question en tête : texte libre → modes opératoires pertinents (recherche
//    dans les titres, résumés et étapes de tous les chapitres), ouverts sur la bonne étape ;
//  - un pavé par chapitre (grande icône) ; un clic ouvre une fenêtre flottante large
//    avec la liste des modes opératoires du chapitre ;
//  - les administrateurs déposent / remplacent / masquent / suppriment un chapitre par
//    glisser-déposer, sans conversion, et choisissent titre, ordre et icône ;
//  - lecture dans le compagnon : la page d'origine (sommaire, navigation, impression,
//    PDF) s'affiche dans une iframe isolée (srcdoc + sandbox).
// Au dépôt, les captures et PDF intégrés sont extraits en fichiers séparés (bucket
// privé « guides-blg ») : la page passe de ~20 Mo à ~160 Ko (lib/guidesBlg.ts).
// Droits : lecture can_guides_blg (ou administration), dépôt réservé aux
// administrateurs — contrôlés en base (peut_lire_guides_blg / peut_gerer_guides_blg).
// URL : ?chapitre=clients&ancre=comprendre-fiche-04 (ouvre le chapitre sur une étape).
// Migrations : 20261103g_guides_blg.sql, 20261103h_guides_blg_icone.sql
// ============================================================================

import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { themed, tc } from '@/lib/theme'
import {
  GUIDES_BUCKET,
  GUIDES_URL_TTL,
  assetsReferences,
  construireGuide,
  degradeGuide,
  formatTaille,
  iconeGuide,
  indexerGuide,
  preparerGuide,
  rechercherModops,
  type GuideModopIndex,
  type GuideSommaireItem,
  type ResultatRecherche,
} from '@/lib/guidesBlg'

type GuideRow = {
  slug: string
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
  updated_at: string
  updated_by: string | null
}

type IndexGuide = { prefixe: string; modops: GuideModopIndex[] }

const EXEMPLES = ['bloquer un client', 'créer une adresse de livraison', 'livraison partielle', 'réserver un article', 'devis Préco']

const s = themed({
  page: { padding: '20px 24px 40px', color: '#F5F3EC', fontFamily: '"IBM Plex Sans", system-ui, sans-serif', minHeight: '100vh', background: '#0B1220' },
  header: { display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, marginBottom: 16 },
  title: { margin: 0, fontFamily: '"Space Grotesk", system-ui, sans-serif', fontSize: 26, fontWeight: 700, letterSpacing: -0.3, color: '#ffffff' },
  subtitle: { margin: '6px 0 0', fontSize: 13, color: 'rgba(245,243,236,0.62)', maxWidth: 860, lineHeight: 1.5 },
  // Recherche
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
  // Pavés
  tiles: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 16 },
  tile: { position: 'relative', borderRadius: 18, padding: '22px 18px 18px', minHeight: 200, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 8, cursor: 'pointer', color: '#ffffff', border: '1px solid rgba(255,255,255,0.10)', boxShadow: '0 6px 18px rgba(0,0,0,0.25)', textAlign: 'left' },
  tileIcon: { fontSize: 54, lineHeight: 1, width: 84, height: 84, borderRadius: 20, background: 'rgba(255,255,255,0.18)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  tileTitle: { fontFamily: '"Space Grotesk", system-ui, sans-serif', fontSize: 21, fontWeight: 700, color: '#ffffff', margin: 0 },
  tileSub: { fontSize: 12, color: 'rgba(255,255,255,0.78)' },
  tileBadge: { position: 'absolute', top: 12, right: 12, fontSize: 11, padding: '3px 9px', borderRadius: 999, background: 'rgba(224,122,78,0.85)', color: '#ffffff', fontWeight: 600 },
  // Fenêtre flottante
  overlay: { position: 'fixed', inset: 0, zIndex: 900, background: 'rgba(5,9,18,0.72)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '5vh 2vw', overflowY: 'auto' },
  modal: { width: 'min(1180px, 96vw)', borderRadius: 18, background: '#101A2E', border: '1px solid rgba(255,255,255,0.14)', boxShadow: '0 20px 60px rgba(0,0,0,0.5)', overflow: 'hidden' },
  modalHead: { display: 'flex', alignItems: 'center', gap: 16, padding: '18px 22px', color: '#ffffff' },
  modalIcon: { fontSize: 44, width: 68, height: 68, borderRadius: 16, background: 'rgba(255,255,255,0.18)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  modalTitle: { margin: 0, fontFamily: '"Space Grotesk", system-ui, sans-serif', fontSize: 24, fontWeight: 700, color: '#ffffff' },
  modalBody: { padding: '16px 22px 20px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(460px, 1fr))', gap: 10 },
  modop: { display: 'flex', gap: 14, alignItems: 'flex-start', padding: '12px 14px', borderRadius: 12, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', cursor: 'pointer' },
  modopNum: { fontSize: 11, color: '#A6A181', fontWeight: 700, letterSpacing: 0.4, minWidth: 82, paddingTop: 3, whiteSpace: 'nowrap' },
  modopTitle: { fontSize: 15, fontWeight: 600, color: '#ffffff', lineHeight: 1.35 },
  modopResume: { fontSize: 12.5, color: 'rgba(245,243,236,0.62)', marginTop: 4, lineHeight: 1.45 },
  modopCount: { marginLeft: 'auto', fontSize: 12, color: 'rgba(245,243,236,0.55)', whiteSpace: 'nowrap', paddingTop: 2 },
  modalFoot: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', padding: '12px 22px 16px', borderTop: '1px solid rgba(255,255,255,0.08)' },
  // Divers
  muted: { fontSize: 12, color: 'rgba(245,243,236,0.5)' },
  btn: { background: 'rgba(255,255,255,0.08)', color: '#F5F3EC', border: '1px solid rgba(255,255,255,0.16)', borderRadius: 8, padding: '7px 12px', fontSize: 13, cursor: 'pointer' },
  btnPrimary: { background: '#A6A181', color: '#0B1220', border: '1px solid #A6A181', borderRadius: 8, padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  btnClose: { marginLeft: 'auto', background: 'rgba(255,255,255,0.14)', color: '#ffffff', border: 'none', borderRadius: 10, width: 38, height: 38, fontSize: 20, cursor: 'pointer', flexShrink: 0 },
  btnDanger: { background: 'transparent', color: '#E07A4E', border: '1px solid rgba(224,122,78,0.5)', borderRadius: 8, padding: '7px 12px', fontSize: 13, cursor: 'pointer' },
  drop: { borderRadius: 14, border: '2px dashed rgba(166,161,129,0.55)', padding: '14px 18px', marginTop: 22, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 14, background: 'rgba(166,161,129,0.06)' },
  dropOn: { borderRadius: 14, border: '2px dashed #A6A181', padding: '14px 18px', marginTop: 22, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 14, background: 'rgba(166,161,129,0.20)' },
  error: { padding: '12px 14px', borderRadius: 10, background: 'rgba(193,104,60,0.15)', border: '1px solid rgba(193,104,60,0.5)', color: '#E07A4E', marginBottom: 16, fontSize: 13 },
  info: { padding: '10px 14px', borderRadius: 10, background: 'rgba(143,199,218,0.10)', border: '1px solid rgba(143,199,218,0.35)', color: '#8FC7DA', marginBottom: 16, fontSize: 13 },
  readerBar: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginBottom: 10 },
  select: { background: 'rgba(11,18,32,0.9)', color: '#F5F3EC', border: '1px solid rgba(255,255,255,0.16)', borderRadius: 8, padding: '7px 10px', fontSize: 13, maxWidth: 420 },
  frameWrap: { borderRadius: 12, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.12)', background: '#EFEFEA' },
  loading: { padding: 40, textAlign: 'center', color: '#78817D', fontSize: 14 },
})

export default function GuidesBlgPage() {
  return (
    <Suspense fallback={<div style={s.page}>Chargement…</div>}>
      <GuidesBlgContent />
    </Suspense>
  )
}

async function chargerIndex(prefixe: string): Promise<GuideModopIndex[]> {
  const { data, error } = await supabase.storage.from(GUIDES_BUCKET).download(`${prefixe}/index.html`)
  if (error || !data) return []
  return indexerGuide(await data.text())
}

function GuidesBlgContent() {
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
  const [dragOver, setDragOver] = useState(false)
  const [tick, setTick] = useState(0)
  const [ouvert, setOuvert] = useState<string | null>(null)
  const [question, setQuestion] = useState('')
  const [indexes, setIndexes] = useState<Map<string, IndexGuide>>(new Map())
  const [indexation, setIndexation] = useState(false)
  const fileInput = useRef<HTMLInputElement | null>(null)
  const enCours = useRef<Set<string>>(new Set())

  const naviguer = useCallback(
    (slug: string | null, a?: string | null) => {
      const p = new URLSearchParams()
      if (slug) p.set('chapitre', slug)
      if (slug && a) p.set('ancre', a)
      const qs = p.toString()
      router.push(qs ? `/guides-blg?${qs}` : '/guides-blg', { scroll: true })
    },
    [router],
  )

  // Catalogue + droit de gestion
  useEffect(() => {
    let active = true
    void (async () => {
      const [{ data, error: err }, droit] = await Promise.all([
        supabase.from('guides_blg').select('*').order('ordre', { ascending: true }).order('titre', { ascending: true }),
        supabase.rpc('peut_gerer_guides_blg'),
      ])
      if (!active) return
      if (err) setError(`Lecture des guides : ${err.message}`)
      setGuides(((data ?? []) as GuideRow[]).map((g) => ({ ...g, sommaire: Array.isArray(g.sommaire) ? g.sommaire : [] })))
      setGestion(Boolean(droit.data))
      setLoading(false)
    })()
    return () => {
      active = false
    }
  }, [tick])

  const visibles = useMemo(() => guides.filter((g) => g.actif || gestion), [guides, gestion])
  const courant = useMemo(() => (chapitre ? guides.find((g) => g.slug === chapitre) ?? null : null), [guides, chapitre])
  const guideOuvert = useMemo(() => (ouvert ? guides.find((g) => g.slug === ouvert) ?? null : null), [guides, ouvert])
  const rang = useMemo(() => new Map(visibles.map((g, i) => [g.slug, i])), [visibles])

  // Index de recherche : page de chaque chapitre téléchargée à la demande, gardée en mémoire.
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

  const lisibles = useMemo(() => guides.filter((g) => g.actif), [guides])
  useEffect(() => {
    if (question.trim().length >= 2) void indexer(lisibles)
  }, [question, lisibles, indexer])
  useEffect(() => {
    if (guideOuvert) void indexer([guideOuvert])
  }, [guideOuvert, indexer])

  const resultats: ResultatRecherche[] = useMemo(() => {
    if (question.trim().length < 2) return []
    const corpus = lisibles
      .map((g) => ({ slug: g.slug, titre: g.titre, icone: iconeGuide(g.slug, g.titre, g.icone), modops: indexes.get(g.slug)?.modops ?? [] }))
      .filter((g) => g.modops.length)
    return rechercherModops(question, corpus, 8)
  }, [question, lisibles, indexes])

  // Fenêtre flottante : Échap pour fermer.
  useEffect(() => {
    if (!ouvert) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOuvert(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ouvert])

  // ── Dépôt ────────────────────────────────────────────────────────────────
  const deposer = async (files: FileList | File[] | null) => {
    const liste = Array.from(files ?? []).filter((f) => /\.html?$/i.test(f.name))
    if (!liste.length) {
      setError('Déposez un ou plusieurs fichiers .html (chapitres des modes opératoires).')
      return
    }
    setError(null)
    setMessage(null)
    const { data: userData } = await supabase.auth.getUser()
    const auteur = userData.user?.email ?? null
    const faits: string[] = []
    let ordreMax = guides.reduce((m, g) => Math.max(m, g.ordre ?? 0), 0)
    try {
      for (const file of liste) {
        setBusy(`${file.name} : préparation…`)
        const prep = await preparerGuide(file)
        const existant = guides.find((g) => g.slug === prep.slug) ?? null
        const version = (existant?.version ?? 0) + 1
        const prefixe = `${prep.slug}/v${version}`
        const bucket = supabase.storage.from(GUIDES_BUCKET)

        let envoyes = 0
        const queue = [...prep.assets]
        const worker = async () => {
          for (let a = queue.shift(); a; a = queue.shift()) {
            const { error: upErr } = await bucket.upload(`${prefixe}/${a.nom}`, a.blob, { contentType: a.mime, upsert: true, cacheControl: '31536000' })
            if (upErr) throw new Error(`${a.nom} : ${upErr.message}`)
            envoyes++
            setBusy(`${file.name} : envoi des images et PDF ${envoyes}/${prep.assets.length}…`)
          }
        }
        await Promise.all(Array.from({ length: 6 }, () => worker()))

        setBusy(`${file.name} : enregistrement de la page…`)
        const page = new Blob([prep.html], { type: 'text/plain;charset=utf-8' })
        const { error: pageErr } = await bucket.upload(`${prefixe}/index.html`, page, { contentType: 'text/plain;charset=utf-8', upsert: true, cacheControl: '60' })
        if (pageErr) throw new Error(`page : ${pageErr.message}`)

        if (!existant) ordreMax += 10
        const { error: rowErr } = await supabase.from('guides_blg').upsert(
          {
            slug: prep.slug,
            titre: existant?.titre ?? prep.titre,
            sous_titre: prep.sous_titre || null,
            fichier_origine: file.name,
            ordre: existant?.ordre ?? ordreMax,
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
            updated_at: new Date().toISOString(),
            updated_by: auteur,
          },
          { onConflict: 'slug' },
        )
        if (rowErr) throw new Error(`catalogue : ${rowErr.message}`)

        if (existant?.prefixe && existant.prefixe !== prefixe) await viderDossier(existant.prefixe)

        faits.push(`${prep.titre} (${prep.nb_modop} modes opératoires, ${prep.nb_etapes} étapes, ${formatTaille(prep.taille_origine)} → page ${formatTaille(prep.taille_page)})`)
      }
      setMessage(`Chapitre${faits.length > 1 ? 's' : ''} publié${faits.length > 1 ? 's' : ''} : ${faits.join(' · ')}.`)
    } catch (e) {
      setError(`Dépôt interrompu — ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(null)
      setTick((n) => n + 1)
    }
  }

  const viderDossier = async (prefixe: string) => {
    const bucket = supabase.storage.from(GUIDES_BUCKET)
    for (;;) {
      const { data } = await bucket.list(prefixe, { limit: 1000 })
      const paths = (data ?? []).filter((o) => o.name).map((o) => `${prefixe}/${o.name}`)
      if (!paths.length) break
      const { error: rmErr } = await bucket.remove(paths)
      if (rmErr || paths.length < 1000) break
    }
  }

  const basculerActif = async (g: GuideRow) => {
    const { error: err } = await supabase.from('guides_blg').update({ actif: !g.actif }).eq('slug', g.slug)
    if (err) setError(err.message)
    setTick((n) => n + 1)
  }

  const modifier = async (g: GuideRow) => {
    const titre = window.prompt('Titre du chapitre', g.titre)
    if (titre === null || !titre.trim()) return
    const ordreTxt = window.prompt('Ordre d’affichage (nombre, du plus petit au plus grand)', String(g.ordre))
    if (ordreTxt === null) return
    const icone = window.prompt('Icône du pavé (un emoji, vide = icône automatique)', g.icone ?? iconeGuide(g.slug, g.titre))
    if (icone === null) return
    const ordre = Number(ordreTxt)
    const { error: err } = await supabase
      .from('guides_blg')
      .update({ titre: titre.trim(), ordre: Number.isFinite(ordre) ? ordre : g.ordre, icone: icone.trim() || null })
      .eq('slug', g.slug)
    if (err) setError(err.message)
    setTick((n) => n + 1)
  }

  const supprimer = async (g: GuideRow) => {
    if (!window.confirm(`Supprimer le chapitre « ${g.titre} » et tous ses fichiers ?`)) return
    setBusy(`Suppression de ${g.titre}…`)
    await viderDossier(g.prefixe)
    const { error: err } = await supabase.from('guides_blg').delete().eq('slug', g.slug)
    if (err) setError(err.message)
    setBusy(null)
    setOuvert(null)
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
            <button type="button" style={s.btn} onClick={() => naviguer(null)}>Voir tous les guides</button>
          </div>
        )}
      </div>
    )
  }

  // ── Catalogue ────────────────────────────────────────────────────────────
  const q = question.trim()
  const modopsOuvert: Array<GuideSommaireItem & { resume?: string }> = guideOuvert
    ? (() => {
        const idx = indexes.get(guideOuvert.slug)
        if (idx?.prefixe === guideOuvert.prefixe && idx.modops.length) {
          return idx.modops.map((m) => ({ id: m.id, numero: m.numero, titre: m.titre, nb_etapes: m.etapes.length, resume: m.resume }))
        }
        return guideOuvert.sommaire ?? []
      })()
    : []
  const degradeOuvert = guideOuvert ? degradeGuide(rang.get(guideOuvert.slug) ?? 0) : null

  return (
    <div style={s.page}>
      <div style={s.header}>
        <div>
          <h1 style={s.title}>Guides BLG</h1>
          <p style={s.subtitle}>Modes opératoires BLG Cloud : posez votre question, ou ouvrez un chapitre pour parcourir ses modes opératoires.</p>
        </div>
      </div>

      {error && <div style={s.error}>{error}</div>}
      {message && <div style={s.info}>{message}</div>}

      {/* Question libre */}
      <div style={s.askBox}>
        <div style={s.askLabel}>Que voulez-vous faire dans BLG ?</div>
        <div style={s.askRow}>
          <input
            style={s.askInput}
            value={question}
            placeholder="Ex. : comment bloquer un client qui ne paie pas ? livrer une commande en partie ?"
            onChange={(e) => setQuestion(e.target.value)}
            onFocus={() => void indexer(lisibles)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && resultats[0]) naviguer(resultats[0].slug, resultats[0].ancre)
              if (e.key === 'Escape') setQuestion('')
            }}
            aria-label="Question sur BLG"
          />
          {q && (
            <button type="button" style={s.btn} onClick={() => setQuestion('')}>Effacer</button>
          )}
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
              <div style={s.muted}>{indexation ? 'Lecture des guides…' : 'Aucun mode opératoire ne correspond. Essayez avec d’autres mots (ex. « livraison », « tag », « devis »).'}</div>
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

      {/* Pavés */}
      {loading ? (
        <div style={s.muted}>Chargement…</div>
      ) : visibles.length === 0 ? (
        <div style={s.info}>Aucun guide publié pour le moment.</div>
      ) : (
        <div style={s.tiles}>
          {visibles.map((g, i) => {
            const [c1, c2] = degradeGuide(i)
            return (
              <button
                key={g.slug}
                type="button"
                style={{ ...s.tile, background: `linear-gradient(160deg, ${c1}, ${c2})`, opacity: g.actif ? 1 : 0.55 }}
                onClick={() => setOuvert(g.slug)}
                onMouseEnter={(e) => (e.currentTarget.style.transform = 'translateY(-3px)')}
                onMouseLeave={(e) => (e.currentTarget.style.transform = 'none')}
              >
                {!g.actif && <span style={s.tileBadge}>Masqué</span>}
                <div style={s.tileIcon}>{iconeGuide(g.slug, g.titre, g.icone)}</div>
                <h2 style={s.tileTitle}>{g.titre}</h2>
                <div style={s.tileSub}>
                  {g.nb_modop} mode{g.nb_modop > 1 ? 's' : ''} opératoire{g.nb_modop > 1 ? 's' : ''} · {g.nb_etapes} étapes
                  {g.nb_pdf > 0 ? ` · ${g.nb_pdf} PDF` : ''}
                </div>
              </button>
            )
          })}
        </div>
      )}

      {/* Dépôt (administrateurs) */}
      {gestion && (
        <div
          style={dragOver ? s.dropOn : s.drop}
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragOver(false)
            if (!busy) void deposer(e.dataTransfer.files)
          }}
        >
          <div style={{ flex: 1, minWidth: 240 }}>
            <div style={{ fontWeight: 600, color: tc('#ffffff') }}>Déposer un chapitre</div>
            <div style={s.muted}>
              Glissez ici un ou plusieurs fichiers CHAPITRE-xxx.html, tels quels. Un chapitre déjà publié (même nom de fichier) est remplacé par la nouvelle version.
            </div>
            {busy && <div style={{ ...s.muted, color: tc('#8FC7DA'), marginTop: 6 }}>{busy}</div>}
          </div>
          <input
            ref={fileInput}
            type="file"
            accept=".html,.htm,text/html"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => {
              void deposer(e.target.files)
              e.target.value = ''
            }}
          />
          <button type="button" style={s.btnPrimary} disabled={Boolean(busy)} onClick={() => fileInput.current?.click()}>
            {busy ? 'Dépôt en cours…' : 'Choisir un fichier'}
          </button>
        </div>
      )}

      {/* Fenêtre flottante : modes opératoires du chapitre */}
      {guideOuvert && degradeOuvert && (
        <div style={s.overlay} onClick={() => setOuvert(null)}>
          <div style={s.modal} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={guideOuvert.titre}>
            <div style={{ ...s.modalHead, background: `linear-gradient(120deg, ${degradeOuvert[0]}, ${degradeOuvert[1]})` }}>
              <div style={s.modalIcon}>{iconeGuide(guideOuvert.slug, guideOuvert.titre, guideOuvert.icone)}</div>
              <div style={{ minWidth: 0 }}>
                <h2 style={s.modalTitle}>{guideOuvert.titre}</h2>
                <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.8)' }}>
                  {guideOuvert.sous_titre ? `${guideOuvert.sous_titre} · ` : ''}
                  {guideOuvert.nb_modop} modes opératoires · {guideOuvert.nb_etapes} étapes · MAJ {new Date(guideOuvert.updated_at).toLocaleDateString('fr-FR')}
                </div>
              </div>
              <button type="button" style={{ ...s.btnPrimary, marginLeft: 'auto' }} onClick={() => naviguer(guideOuvert.slug)}>Ouvrir le guide complet</button>
              <button type="button" style={{ ...s.btnClose, marginLeft: 0 }} onClick={() => setOuvert(null)} aria-label="Fermer">×</button>
            </div>
            <div style={s.modalBody}>
              {modopsOuvert.length === 0 && <div style={s.muted}>Aucun mode opératoire détecté dans ce chapitre.</div>}
              {modopsOuvert.map((m) => (
                <div
                  key={m.id}
                  style={s.modop}
                  onClick={() => naviguer(guideOuvert.slug, m.id)}
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
              <div style={s.modalFoot}>
                <button type="button" style={s.btn} onClick={() => void modifier(guideOuvert)}>Titre / ordre / icône</button>
                <button type="button" style={s.btn} onClick={() => void basculerActif(guideOuvert)}>{guideOuvert.actif ? 'Masquer' : 'Publier'}</button>
                <button type="button" style={s.btnDanger} disabled={Boolean(busy)} onClick={() => void supprimer(guideOuvert)}>Supprimer</button>
                <span style={{ ...s.muted, marginLeft: 'auto' }}>
                  {guideOuvert.fichier_origine ?? '—'} · v{guideOuvert.version} · {formatTaille(guideOuvert.taille_origine)} → {formatTaille(guideOuvert.taille_page)} · {guideOuvert.nb_images} images
                  {guideOuvert.updated_by ? ` · ${guideOuvert.updated_by}` : ''}
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Lecteur ────────────────────────────────────────────────────────────────
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
        {!pleinEcran && (
          <button type="button" style={s.btn} onClick={onRetour}>← Tous les guides</button>
        )}
        <div style={{ fontFamily: '"Space Grotesk", system-ui, sans-serif', fontSize: 18, fontWeight: 700, color: tc('#ffffff') }}>
          {iconeGuide(guide.slug, guide.titre, guide.icone)} {guide.titre}
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
