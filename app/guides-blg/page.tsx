'use client'

// ============================================================================
// app/guides-blg/page.tsx — Bloc « Guides BLG » (modes opératoires BLG Cloud) — 03/11/2026
// ----------------------------------------------------------------------------
// Bibliothèque des chapitres HTML autonomes (CHAPITRE-Clients.html…) :
//  - liste des chapitres (cartes) ; les administrateurs déposent / remplacent /
//    masquent / suppriment un chapitre par glisser-déposer, sans conversion ;
//  - lecture dans le compagnon : la page d'origine (sommaire, navigation, impression,
//    PDF) s'affiche dans une iframe isolée (srcdoc + sandbox).
// Au dépôt, les captures et PDF intégrés sont extraits en fichiers séparés (bucket
// privé « guides-blg ») : la page passe de ~20 Mo à ~160 Ko (lib/guidesBlg.ts).
// Droits : lecture can_guides_blg (ou administration), dépôt réservé aux
// administrateurs — contrôlés en base (peut_lire_guides_blg / peut_gerer_guides_blg).
// URL : ?chapitre=clients&ancre=comprendre-fiche-04 (ouvre le chapitre sur une étape).
// Migration : supabase/migrations/20261103g_guides_blg.sql
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
  formatTaille,
  preparerGuide,
  type GuideSommaireItem,
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
  updated_at: string
  updated_by: string | null
}

const s = themed({
  page: { padding: '20px 24px 40px', color: '#F5F3EC', fontFamily: '"IBM Plex Sans", system-ui, sans-serif', minHeight: '100vh', background: '#0B1220' },
  header: { display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, marginBottom: 18 },
  title: { margin: 0, fontFamily: '"Space Grotesk", system-ui, sans-serif', fontSize: 26, fontWeight: 700, letterSpacing: -0.3, color: '#ffffff' },
  subtitle: { margin: '6px 0 0', fontSize: 13, color: 'rgba(245,243,236,0.62)', maxWidth: 860, lineHeight: 1.5 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 },
  card: { borderRadius: 14, background: 'rgba(255,255,255,0.045)', border: '1px solid rgba(255,255,255,0.10)', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10 },
  cardTitle: { margin: 0, fontSize: 18, fontWeight: 700, color: '#ffffff', fontFamily: '"Space Grotesk", system-ui, sans-serif' },
  cardSub: { fontSize: 13, color: 'rgba(245,243,236,0.62)' },
  chips: { display: 'flex', flexWrap: 'wrap', gap: 6 },
  chip: { fontSize: 11, padding: '3px 9px', borderRadius: 999, background: 'rgba(166,161,129,0.18)', color: '#E8E4D2' },
  modops: { margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 2 },
  modop: { display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 13, padding: '5px 8px', borderRadius: 8, cursor: 'pointer', color: '#F5F3EC' },
  modopNum: { fontSize: 11, color: 'rgba(245,243,236,0.5)', minWidth: 74, whiteSpace: 'nowrap' },
  modopCount: { marginLeft: 'auto', fontSize: 11, color: 'rgba(245,243,236,0.45)', whiteSpace: 'nowrap' },
  muted: { fontSize: 12, color: 'rgba(245,243,236,0.5)' },
  btn: { background: 'rgba(255,255,255,0.08)', color: '#F5F3EC', border: '1px solid rgba(255,255,255,0.16)', borderRadius: 8, padding: '7px 12px', fontSize: 13, cursor: 'pointer' },
  btnPrimary: { background: '#A6A181', color: '#0B1220', border: '1px solid #A6A181', borderRadius: 8, padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  btnDanger: { background: 'transparent', color: '#E07A4E', border: '1px solid rgba(224,122,78,0.5)', borderRadius: 8, padding: '7px 12px', fontSize: 13, cursor: 'pointer' },
  drop: { borderRadius: 14, border: '2px dashed rgba(166,161,129,0.55)', padding: '18px 20px', marginBottom: 18, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 14, background: 'rgba(166,161,129,0.06)' },
  dropOn: { borderRadius: 14, border: '2px dashed #A6A181', padding: '18px 20px', marginBottom: 18, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 14, background: 'rgba(166,161,129,0.20)' },
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
  const fileInput = useRef<HTMLInputElement | null>(null)

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
          while (queue.length) {
            const a = queue.shift()!
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

        const { error: rowErr } = await supabase.from('guides_blg').upsert(
          {
            slug: prep.slug,
            titre: existant?.titre ?? prep.titre,
            sous_titre: prep.sous_titre || null,
            fichier_origine: file.name,
            ordre: existant?.ordre ?? (guides.length + 1) * 10,
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
            updated_at: new Date().toISOString(),
            updated_by: auteur,
          },
          { onConflict: 'slug' },
        )
        if (rowErr) throw new Error(`catalogue : ${rowErr.message}`)

        // Ancienne version : fichiers supprimés une fois la nouvelle en place.
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

  const renommer = async (g: GuideRow) => {
    const titre = window.prompt('Titre du chapitre', g.titre)
    if (titre === null || !titre.trim()) return
    const ordreTxt = window.prompt('Ordre d’affichage (nombre, du plus petit au plus grand)', String(g.ordre))
    const ordre = Number(ordreTxt)
    const { error: err } = await supabase
      .from('guides_blg')
      .update({ titre: titre.trim(), ordre: Number.isFinite(ordre) ? ordre : g.ordre })
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
  return (
    <div style={s.page}>
      <div style={s.header}>
        <div>
          <h1 style={s.title}>Guides BLG</h1>
          <p style={s.subtitle}>
            Modes opératoires BLG Cloud, chapitre par chapitre : chaque étape illustrée, impression et PDF disponibles dans le guide.
            Cliquez sur un chapitre, ou directement sur un mode opératoire pour l’ouvrir au bon endroit.
          </p>
        </div>
      </div>

      {error && <div style={s.error}>{error}</div>}
      {message && <div style={s.info}>{message}</div>}

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

      {loading ? (
        <div style={s.muted}>Chargement…</div>
      ) : visibles.length === 0 ? (
        <div style={s.info}>Aucun guide publié pour le moment.</div>
      ) : (
        <div style={s.grid}>
          {visibles.map((g) => (
            <div key={g.slug} style={{ ...s.card, ...(g.actif ? {} : { opacity: 0.55 }) }}>
              <div style={{ cursor: 'pointer' }} onClick={() => naviguer(g.slug)}>
                <h2 style={s.cardTitle}>📘 {g.titre}</h2>
                {g.sous_titre && <div style={s.cardSub}>{g.sous_titre}</div>}
              </div>
              <div style={s.chips}>
                <span style={s.chip}>{g.nb_modop} modes opératoires</span>
                <span style={s.chip}>{g.nb_etapes} étapes</span>
                {g.nb_pdf > 0 && <span style={s.chip}>{g.nb_pdf} PDF</span>}
                {!g.actif && <span style={{ ...s.chip, background: tc('rgba(224,122,78,0.25)') }}>Masqué</span>}
              </div>
              {(g.sommaire ?? []).length > 0 && (
                <ul style={s.modops}>
                  {(g.sommaire ?? []).map((m) => (
                    <li
                      key={m.id}
                      style={s.modop}
                      onClick={() => naviguer(g.slug, m.id)}
                      onMouseEnter={(e) => (e.currentTarget.style.background = tc('rgba(166,161,129,0.16)'))}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                    >
                      <span style={s.modopNum}>{m.numero}</span>
                      <span>{m.titre}</span>
                      <span style={s.modopCount}>{m.nb_etapes} ét.</span>
                    </li>
                  ))}
                </ul>
              )}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 'auto' }}>
                <button type="button" style={s.btnPrimary} onClick={() => naviguer(g.slug)}>Ouvrir le guide</button>
                <span style={s.muted}>MAJ {new Date(g.updated_at).toLocaleDateString('fr-FR')}</span>
              </div>
              {gestion && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', borderTop: `1px solid ${tc('rgba(255,255,255,0.08)')}`, paddingTop: 10 }}>
                  <button type="button" style={s.btn} onClick={() => void renommer(g)}>Titre / ordre</button>
                  <button type="button" style={s.btn} onClick={() => void basculerActif(g)}>{g.actif ? 'Masquer' : 'Publier'}</button>
                  <button type="button" style={s.btnDanger} disabled={Boolean(busy)} onClick={() => void supprimer(g)}>Supprimer</button>
                  <span style={{ ...s.muted, width: '100%' }}>
                    {g.fichier_origine ?? '—'} · v{g.version} · {formatTaille(g.taille_origine)} → {formatTaille(g.taille_page)} · {g.nb_images} images
                    {g.updated_by ? ` · ${g.updated_by}` : ''}
                  </span>
                </div>
              )}
            </div>
          ))}
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
          📘 {guide.titre}
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
