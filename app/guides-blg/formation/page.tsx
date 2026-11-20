'use client'

// ============================================================================
// app/guides-blg/formation/page.tsx — Guides BLG › Formation — 10/11/2026
// ----------------------------------------------------------------------------
// Supports de formation PDF du dossier Teams « z - Formation », publiés sous le nom
// « Formation » par la synchronisation OneDrive du Mac (scripts/guides-blg-sync.ts) :
//  - l'arborescence Teams est reprise telle quelle (dossiers → sous-dossiers → PDF),
//    navigation par fil d'Ariane, URL ?dossier=<chemin relatif> ;
//  - seuls les PDF sont synchronisés ; un dossier sans contenu n'apparaît pas ;
//  - recherche sur les noms de fichiers et de dossiers, tous niveaux confondus ;
//  - un PDF s'ouvre dans la page (lecteur intégré), dans un nouvel onglet ou se
//    télécharge sous son nom d'origine (URL signée, bucket privé « guides-blg »).
// 20/11/2026 — vidéos de formation (enregistrements Teams MP4, jusqu'à plusieurs
//   centaines de Mo) : pas de synchronisation ; l'administration les dépose à la main
//   dans le dossier ouvert (glisser-déposer), envoi reprenable par morceaux de 6 Mo
//   (TUS) avec progression ; lecture dans le compagnon (lecteur vidéo, lecture
//   progressive sans téléchargement complet), URL ?video=<id> ; renommer, déplacer
//   vers un autre dossier, supprimer. Table guides_blg_formation_videos, fichiers
//   sous formation-videos/<uuid>.<ext> (la synchro des PDF n'y touche pas).
// Droits : lecture can_guides_blg (ou administration), comme les chapitres ; dépôt et
//   gestion des vidéos : administration (peut_gerer_guides_blg).
// Migrations : 20261110a_guides_blg_formation.sql, 20261120a_guides_blg_formation_videos.sql
// ============================================================================

import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import * as tus from 'tus-js-client'
import { supabase } from '@/lib/supabaseClient'
import { themed, tc } from '@/lib/theme'
import { GUIDES_BUCKET, GUIDES_URL_TTL, formatTaille } from '@/lib/guidesBlg'

type FichierRow = {
  chemin: string
  dossier: string
  nom: string
  taille: number | null
  hash: string
  storage_path: string
  modifie_le: string | null
  updated_at: string
}

type VideoRow = {
  id: string
  dossier: string
  titre: string
  nom: string
  taille: number | null
  duree_s: number | null
  mime: string
  storage_path: string
  created_at: string
  created_by: string | null
}

type EtatRow = {
  titre: string
  icone: string
  actif: boolean
  verifie_at: string | null
  message: string | null
  nb_fichiers: number
  nb_dossiers: number
}

type SousDossier = { chemin: string; nom: string; nbPdf: number; nbVideos: number; nbDossiers: number; maj: string | null }

type Envoi = { nom: string; envoye: number; total: number; etat: 'attente' | 'envoi' | 'ok' | 'erreur'; message?: string }

const VIDEO_PREFIXE = 'formation-videos'
const VIDEO_EXT = /\.(mp4|m4v|mov|webm)$/i
const TUS_MORCEAU = 6 * 1024 * 1024

const DEGRADES: [string, string][] = [
  ['#B08A3E', '#6E5420'],
  ['#2E6E66', '#173C3A'],
  ['#245A9E', '#173B6C'],
  ['#7A5EA8', '#4B3870'],
  ['#3B7D4F', '#1F4A2C'],
  ['#B5643A', '#7A3D1E'],
]

const s = themed({
  page: { padding: '20px 24px 40px', color: '#F5F3EC', fontFamily: '"IBM Plex Sans", system-ui, sans-serif', minHeight: '100vh', background: '#0B1220' },
  header: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 16, marginBottom: 14 },
  headIcon: { fontSize: 40, width: 64, height: 64, borderRadius: 16, background: 'linear-gradient(160deg, #B08A3E, #6E5420)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  title: { margin: 0, fontFamily: '"Space Grotesk", system-ui, sans-serif', fontSize: 26, fontWeight: 700, letterSpacing: -0.3, color: '#ffffff' },
  subtitle: { margin: '4px 0 0', fontSize: 13, color: 'rgba(245,243,236,0.62)', lineHeight: 1.5 },
  crumbs: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginBottom: 16, fontSize: 14 },
  crumb: { background: 'transparent', border: 'none', color: '#8FC7DA', cursor: 'pointer', padding: '2px 4px', fontSize: 14 },
  crumbCurrent: { color: '#ffffff', fontWeight: 600, padding: '2px 4px' },
  sep: { color: 'rgba(245,243,236,0.35)' },
  search: { flex: 1, minWidth: 220, maxWidth: 520, background: 'rgba(11,18,32,0.9)', color: '#F5F3EC', border: '1px solid rgba(166,161,129,0.55)', borderRadius: 12, padding: '11px 14px', fontSize: 15 },
  sectionTitle: { fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.6, color: 'rgba(245,243,236,0.6)', fontWeight: 600, margin: '18px 0 10px' },
  folders: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 14 },
  folder: { position: 'relative', borderRadius: 16, padding: '18px 16px 16px', minHeight: 130, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 6, cursor: 'pointer', color: '#ffffff', border: '1px solid rgba(255,255,255,0.10)', boxShadow: '0 6px 18px rgba(0,0,0,0.25)', textAlign: 'left' },
  folderIcon: { fontSize: 34, lineHeight: 1 },
  folderTitle: { fontFamily: '"Space Grotesk", system-ui, sans-serif', fontSize: 17, fontWeight: 700, color: '#ffffff', margin: 0, lineHeight: 1.3 },
  folderSub: { fontSize: 12, color: 'rgba(255,255,255,0.78)' },
  files: { display: 'flex', flexDirection: 'column', gap: 6 },
  file: { display: 'flex', alignItems: 'center', gap: 14, padding: '11px 14px', borderRadius: 12, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', cursor: 'pointer' },
  fileIcon: { fontSize: 26, width: 36, textAlign: 'center', flexShrink: 0 },
  fileName: { fontSize: 15, fontWeight: 600, color: '#ffffff', wordBreak: 'break-word' },
  fileMeta: { fontSize: 12, color: 'rgba(245,243,236,0.55)', marginTop: 2 },
  muted: { fontSize: 12, color: 'rgba(245,243,236,0.5)' },
  btn: { background: 'rgba(255,255,255,0.08)', color: '#F5F3EC', border: '1px solid rgba(255,255,255,0.16)', borderRadius: 8, padding: '7px 12px', fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap' },
  btnSmall: { background: 'rgba(255,255,255,0.06)', color: '#F5F3EC', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 7, padding: '4px 9px', fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' },
  btnPrimary: { background: '#A6A181', color: '#0B1220', border: '1px solid #A6A181', borderRadius: 8, padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' },
  btnDanger: { background: 'transparent', color: '#E07A4E', border: '1px solid rgba(224,122,78,0.5)', borderRadius: 7, padding: '4px 9px', fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' },
  error: { padding: '12px 14px', borderRadius: 10, background: 'rgba(193,104,60,0.15)', border: '1px solid rgba(193,104,60,0.5)', color: '#E07A4E', marginBottom: 16, fontSize: 13 },
  info: { padding: '10px 14px', borderRadius: 10, background: 'rgba(143,199,218,0.10)', border: '1px solid rgba(143,199,218,0.35)', color: '#8FC7DA', marginBottom: 16, fontSize: 13 },
  readerBar: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginBottom: 10 },
  frameWrap: { borderRadius: 12, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.12)', background: '#525659' },
  videoWrap: { borderRadius: 12, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.12)', background: '#000000', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  loading: { padding: 40, textAlign: 'center', color: '#C9CCCF', fontSize: 14 },
  drop: { borderRadius: 14, border: '2px dashed rgba(166,161,129,0.55)', padding: '14px 18px', marginTop: 24, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 14, background: 'rgba(166,161,129,0.06)' },
  dropOn: { borderRadius: 14, border: '2px dashed #A6A181', padding: '14px 18px', marginTop: 24, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 14, background: 'rgba(166,161,129,0.20)' },
  bar: { height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.10)', overflow: 'hidden', marginTop: 4 },
})

const trier = (a: string, b: string) => a.localeCompare(b, 'fr', { numeric: true, sensitivity: 'base' })
const sansExt = (nom: string) => nom.replace(/\.[^.]+$/, '')
const normaliser = (v: string) => v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const dansDossier = (d: string, dossier: string) => !dossier || d === dossier || d.startsWith(`${dossier}/`)
const dateCourte = (v: string | null) => (v ? new Date(v).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—')

function formatDuree(sec: number | null | undefined): string {
  const n = Math.round(Number(sec ?? 0))
  if (!n) return ''
  const h = Math.floor(n / 3600)
  const m = Math.floor((n % 3600) / 60)
  const ss = n % 60
  return h ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min ${String(ss).padStart(2, '0')}`
}

/** Durée d'une vidéo lue par le navigateur avant l'envoi (null si illisible). */
function lireDuree(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const v = document.createElement('video')
    let fini = false
    const fin = (d: number | null) => {
      if (fini) return
      fini = true
      URL.revokeObjectURL(url)
      resolve(d)
    }
    v.preload = 'metadata'
    v.onloadedmetadata = () => fin(Number.isFinite(v.duration) ? Math.round(v.duration) : null)
    v.onerror = () => fin(null)
    setTimeout(() => fin(null), 8000)
    v.src = url
  })
}

/** Point d'entrée TUS du stockage Supabase (hôte de stockage direct, conseillé pour les gros fichiers). */
function pointTus(): string {
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/+$/, '')
  const m = /^https:\/\/([a-z0-9]+)\.supabase\.co$/i.exec(base)
  return m ? `https://${m[1]}.storage.supabase.co/storage/v1/upload/resumable` : `${base}/storage/v1/upload/resumable`
}

/** Envoi reprenable (morceaux de 6 Mo, nouvelles tentatives automatiques en cas de coupure). */
async function envoyerTus(file: File, objectName: string, contentType: string, onProgress: (envoye: number, total: number) => void): Promise<void> {
  const { data } = await supabase.auth.getSession()
  const jeton = data.session?.access_token
  if (!jeton) throw new Error('session expirée, reconnectez-vous')
  await new Promise<void>((resolve, reject) => {
    const upload = new tus.Upload(file, {
      endpoint: pointTus(),
      retryDelays: [0, 2000, 5000, 10000, 20000, 30000],
      headers: {
        authorization: `Bearer ${jeton}`,
        apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
        'x-upsert': 'false',
      },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      storeFingerprintForResuming: false,
      metadata: { bucketName: GUIDES_BUCKET, objectName, contentType, cacheControl: '3600' },
      chunkSize: TUS_MORCEAU,
      onError: (e) => reject(e),
      onProgress: (envoye, total) => onProgress(envoye, total),
      onSuccess: () => resolve(),
    })
    upload.start()
  })
}

function messageErreurEnvoi(e: unknown): string {
  const brut = e instanceof Error ? e.message : String(e)
  if (/413|maximum size|payload too large|exceeded the maximum allowed size/i.test(brut))
    return 'fichier plus gros que la limite de téléversement du projet (Supabase › Storage › Settings › Upload file size limit)'
  if (/403|row-level security|unauthorized/i.test(brut)) return 'droit de dépôt refusé (réservé aux administrateurs)'
  return brut.length > 220 ? `${brut.slice(0, 220)}…` : brut
}

export default function FormationPage() {
  return (
    <Suspense fallback={<div style={s.page}>Chargement…</div>}>
      <FormationContent />
    </Suspense>
  )
}

function FormationContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const dossier = (searchParams.get('dossier') ?? '').replace(/^\/+|\/+$/g, '')
  const fichierOuvert = searchParams.get('fichier')
  const videoOuverte = searchParams.get('video')

  const [fichiers, setFichiers] = useState<FichierRow[]>([])
  const [videos, setVideos] = useState<VideoRow[]>([])
  const [etat, setEtat] = useState<EtatRow | null>(null)
  const [gestion, setGestion] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [recherche, setRecherche] = useState('')
  const [tick, setTick] = useState(0)
  const [envois, setEnvois] = useState<Envoi[]>([])
  const [dragOver, setDragOver] = useState(false)
  const fileInput = useRef<HTMLInputElement | null>(null)
  const envoiEnCours = envois.some((e) => e.etat === 'attente' || e.etat === 'envoi')

  useEffect(() => {
    let active = true
    void (async () => {
      const [lignes, vids, et, droit] = await Promise.all([
        supabase.from('guides_blg_formation').select('chemin, dossier, nom, taille, hash, storage_path, modifie_le, updated_at'),
        supabase.from('guides_blg_formation_videos').select('id, dossier, titre, nom, taille, duree_s, mime, storage_path, created_at, created_by'),
        supabase.from('guides_blg_formation_etat').select('titre, icone, actif, verifie_at, message, nb_fichiers, nb_dossiers').eq('id', 1).maybeSingle(),
        supabase.rpc('peut_gerer_guides_blg'),
      ])
      if (!active) return
      if (lignes.error) setError(`Lecture des supports de formation : ${lignes.error.message}`)
      else if (vids.error) setError(`Lecture des vidéos de formation : ${vids.error.message}`)
      setFichiers(((lignes.data ?? []) as FichierRow[]).sort((a, b) => trier(a.chemin, b.chemin)))
      setVideos(((vids.data ?? []) as VideoRow[]).sort((a, b) => trier(a.titre, b.titre)))
      setEtat((et.data as EtatRow | null) ?? null)
      setGestion(Boolean(droit.data))
      setLoading(false)
    })()
    return () => {
      active = false
    }
  }, [tick])

  // Pas de départ accidentel pendant un envoi.
  useEffect(() => {
    if (!envoiEnCours) return
    const avant = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', avant)
    return () => window.removeEventListener('beforeunload', avant)
  }, [envoiEnCours])

  const aller = useCallback(
    (d: string, ouvrir?: { fichier?: string; video?: string }) => {
      const p = new URLSearchParams()
      if (d) p.set('dossier', d)
      if (ouvrir?.fichier) p.set('fichier', ouvrir.fichier)
      if (ouvrir?.video) p.set('video', ouvrir.video)
      const qs = p.toString()
      router.push(qs ? `/guides-blg/formation?${qs}` : '/guides-blg/formation', { scroll: true })
    },
    [router],
  )

  const titre = etat?.titre || 'Formation'
  const icone = etat?.icone || '🎓'

  // Tous les dossiers connus (PDF synchronisés + vidéos déposées), parents compris.
  const tousDossiers = useMemo(() => {
    const set = new Set<string>([''])
    for (const d of [...fichiers.map((f) => f.dossier), ...videos.map((v) => v.dossier)]) {
      const m = d ? d.split('/') : []
      for (let k = 1; k <= m.length; k++) set.add(m.slice(0, k).join('/'))
    }
    return Array.from(set).sort(trier)
  }, [fichiers, videos])

  // Sous-dossiers directs du dossier courant (avec contenu à l'intérieur, à tous niveaux).
  const sousDossiers: SousDossier[] = useMemo(() => {
    const map = new Map<string, SousDossier>()
    const sousDossiersDe = new Map<string, Set<string>>()
    const elements = [
      ...fichiers.map((f) => ({ dossier: f.dossier, maj: f.modifie_le ?? f.updated_at, video: false })),
      ...videos.map((v) => ({ dossier: v.dossier, maj: v.created_at, video: true })),
    ]
    for (const el of elements) {
      if (!dansDossier(el.dossier, dossier) || el.dossier === dossier) continue
      const reste = dossier ? el.dossier.slice(dossier.length + 1) : el.dossier
      const morceaux = reste.split('/')
      const nom = morceaux[0]
      const chemin = dossier ? `${dossier}/${nom}` : nom
      const sd = map.get(chemin) ?? { chemin, nom, nbPdf: 0, nbVideos: 0, nbDossiers: 0, maj: null }
      if (el.video) sd.nbVideos++
      else sd.nbPdf++
      if (!sd.maj || el.maj > sd.maj) sd.maj = el.maj
      map.set(chemin, sd)
      if (morceaux.length > 1) {
        const set = sousDossiersDe.get(chemin) ?? new Set<string>()
        set.add(morceaux[1])
        sousDossiersDe.set(chemin, set)
      }
    }
    return Array.from(map.values())
      .map((sd) => ({ ...sd, nbDossiers: sousDossiersDe.get(sd.chemin)?.size ?? 0 }))
      .sort((a, b) => trier(a.nom, b.nom))
  }, [fichiers, videos, dossier])

  const pdfs = useMemo(() => fichiers.filter((f) => f.dossier === dossier).sort((a, b) => trier(a.nom, b.nom)), [fichiers, dossier])
  const videosIci = useMemo(() => videos.filter((v) => v.dossier === dossier).sort((a, b) => trier(a.titre, b.titre)), [videos, dossier])

  const resultats = useMemo(() => {
    const q = normaliser(recherche.trim())
    if (q.length < 2) return { pdfs: [] as FichierRow[], videos: [] as VideoRow[] }
    const mots = q.split(/\s+/).filter(Boolean)
    const ok = (cible: string) => mots.every((m) => normaliser(cible).includes(m))
    return {
      pdfs: fichiers.filter((f) => ok(f.chemin)),
      videos: videos.filter((v) => ok(`${v.dossier} ${v.titre} ${v.nom}`)),
    }
  }, [fichiers, videos, recherche])

  const dossierExiste = !dossier || tousDossiers.includes(dossier)
  const pdfCourant = fichierOuvert ? fichiers.find((f) => f.chemin === fichierOuvert) ?? null : null
  const videoCourante = videoOuverte ? videos.find((v) => v.id === videoOuverte) ?? null : null
  const documentOuvert = pdfCourant ? sansExt(pdfCourant.nom) : videoCourante ? videoCourante.titre : null

  // ── Gestion des vidéos (administration) ──────────────────────────────────
  const deposer = async (liste: FileList | File[] | null) => {
    const vids = Array.from(liste ?? []).filter((f) => VIDEO_EXT.test(f.name))
    if (!vids.length) {
      setError('Déposez un ou plusieurs fichiers vidéo (.mp4, .m4v, .mov, .webm).')
      return
    }
    setError(null)
    setMessage(null)
    const { data: userData } = await supabase.auth.getUser()
    const auteur = userData.user?.email ?? null
    const cible = dossier
    setEnvois(vids.map((f) => ({ nom: f.name, envoye: 0, total: f.size, etat: 'attente' })))
    const majEnvoi = (i: number, champs: Partial<Envoi>) => setEnvois((prev) => prev.map((e, k) => (k === i ? { ...e, ...champs } : e)))

    let reussis = 0
    for (let i = 0; i < vids.length; i++) {
      const f = vids[i]
      const ext = (/\.([a-z0-9]+)$/i.exec(f.name)?.[1] ?? 'mp4').toLowerCase()
      const id = crypto.randomUUID()
      const objectName = `${VIDEO_PREFIXE}/${id}.${ext}`
      const mime = f.type || (ext === 'webm' ? 'video/webm' : ext === 'mov' ? 'video/quicktime' : 'video/mp4')
      majEnvoi(i, { etat: 'envoi' })
      try {
        const duree = await lireDuree(f)
        await envoyerTus(f, objectName, mime, (envoye, total) => majEnvoi(i, { envoye, total }))
        const { error: insErr } = await supabase.from('guides_blg_formation_videos').insert({
          id,
          dossier: cible,
          titre: sansExt(f.name).replace(/[_]+/g, ' ').trim(),
          nom: f.name,
          taille: f.size,
          duree_s: duree,
          mime,
          storage_path: objectName,
          created_by: auteur,
        })
        if (insErr) {
          await supabase.storage.from(GUIDES_BUCKET).remove([objectName])
          throw new Error(`catalogue : ${insErr.message}`)
        }
        reussis++
        majEnvoi(i, { etat: 'ok', envoye: f.size })
      } catch (e) {
        majEnvoi(i, { etat: 'erreur', message: messageErreurEnvoi(e) })
      }
    }
    if (reussis) setMessage(`${reussis} vidéo${reussis > 1 ? 's' : ''} déposée${reussis > 1 ? 's' : ''} dans « ${cible ? cible.split('/').pop() : titre} ».`)
    setTick((n) => n + 1)
  }

  const renommer = async (v: VideoRow) => {
    const t = window.prompt('Titre de la vidéo', v.titre)
    if (t === null || !t.trim()) return
    const { error: err } = await supabase.from('guides_blg_formation_videos').update({ titre: t.trim(), updated_at: new Date().toISOString() }).eq('id', v.id)
    if (err) setError(err.message)
    setTick((n) => n + 1)
  }

  const deplacer = async (v: VideoRow) => {
    const choix = tousDossiers.map((d, i) => `${i + 1}) ${d ? d.split('/').join(' › ') : titre + ' (racine)'}`).join('\n')
    const rep = window.prompt(`Déplacer « ${v.titre} » vers le dossier n° :\n\n${choix}`, String(tousDossiers.indexOf(v.dossier) + 1))
    if (rep === null) return
    const cible = tousDossiers[Number(rep) - 1]
    if (cible === undefined) {
      setError('Numéro de dossier inconnu.')
      return
    }
    if (cible === v.dossier) return
    const { error: err } = await supabase.from('guides_blg_formation_videos').update({ dossier: cible, updated_at: new Date().toISOString() }).eq('id', v.id)
    if (err) setError(err.message)
    else setMessage(`« ${v.titre} » déplacée dans « ${cible ? cible.split('/').pop() : titre} ».`)
    setTick((n) => n + 1)
  }

  const supprimer = async (v: VideoRow) => {
    if (!window.confirm(`Supprimer la vidéo « ${v.titre} » (${formatTaille(v.taille)}) ?`)) return
    const { error: rmErr } = await supabase.storage.from(GUIDES_BUCKET).remove([v.storage_path])
    if (rmErr) {
      setError(`Suppression du fichier : ${rmErr.message}`)
      return
    }
    const { error: err } = await supabase.from('guides_blg_formation_videos').delete().eq('id', v.id)
    if (err) setError(err.message)
    if (videoOuverte === v.id) aller(v.dossier)
    setTick((n) => n + 1)
  }

  const segments = dossier ? dossier.split('/') : []
  const filAriane = (
    <div style={s.crumbs}>
      <button type="button" style={s.crumb} onClick={() => router.push('/guides-blg')}>Guides BLG</button>
      <span style={s.sep}>›</span>
      {segments.length === 0 && !documentOuvert ? (
        <span style={s.crumbCurrent}>{titre}</span>
      ) : (
        <button type="button" style={s.crumb} onClick={() => aller('')}>{titre}</button>
      )}
      {segments.map((seg, i) => {
        const chemin = segments.slice(0, i + 1).join('/')
        const dernier = i === segments.length - 1 && !documentOuvert
        return (
          <React.Fragment key={chemin}>
            <span style={s.sep}>›</span>
            {dernier ? <span style={s.crumbCurrent}>{seg}</span> : <button type="button" style={s.crumb} onClick={() => aller(chemin)}>{seg}</button>}
          </React.Fragment>
        )
      })}
      {documentOuvert && (
        <>
          <span style={s.sep}>›</span>
          <span style={s.crumbCurrent}>{documentOuvert}</span>
        </>
      )}
    </div>
  )

  // ── Lecture d'un PDF ─────────────────────────────────────────────────────
  if (fichierOuvert) {
    return (
      <div style={s.page}>
        {filAriane}
        {error && <div style={s.error}>{error}</div>}
        {loading ? (
          <div style={s.muted}>Chargement…</div>
        ) : pdfCourant ? (
          <LecteurPdf fichier={pdfCourant} onRetour={() => aller(pdfCourant.dossier)} />
        ) : (
          <div style={s.info}>
            Ce document n’existe plus (il a peut-être été déplacé ou supprimé dans Teams).{' '}
            <button type="button" style={s.btn} onClick={() => aller(dossier)}>Retour au dossier</button>
          </div>
        )}
      </div>
    )
  }

  // ── Lecture d'une vidéo ──────────────────────────────────────────────────
  if (videoOuverte) {
    return (
      <div style={s.page}>
        {filAriane}
        {error && <div style={s.error}>{error}</div>}
        {loading ? (
          <div style={s.muted}>Chargement…</div>
        ) : videoCourante ? (
          <LecteurVideo
            video={videoCourante}
            gestion={gestion}
            onRetour={() => aller(videoCourante.dossier)}
            onRenommer={() => void renommer(videoCourante)}
            onDeplacer={() => void deplacer(videoCourante)}
            onSupprimer={() => void supprimer(videoCourante)}
          />
        ) : (
          <div style={s.info}>
            Cette vidéo n’existe plus.{' '}
            <button type="button" style={s.btn} onClick={() => aller(dossier)}>Retour au dossier</button>
          </div>
        )}
      </div>
    )
  }

  // ── Dossier ──────────────────────────────────────────────────────────────
  const q = recherche.trim()
  const nomDossierCourant = segments.length ? segments[segments.length - 1] : titre
  return (
    <div style={s.page}>
      <div style={s.header}>
        <div style={s.headIcon}>{icone}</div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h1 style={s.title}>{nomDossierCourant}</h1>
          <p style={s.subtitle}>
            Supports de formation BLG (PDF et vidéos), rangés comme dans Teams.
            {etat?.verifie_at ? ` PDF synchronisés le ${new Date(etat.verifie_at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}.` : ''}
          </p>
        </div>
        <input
          style={s.search}
          value={recherche}
          placeholder="Rechercher un support (ex. devis, séance 3…)"
          onChange={(e) => setRecherche(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setRecherche('')
          }}
          aria-label="Rechercher un support de formation"
        />
      </div>

      {filAriane}
      {error && <div style={s.error}>{error}</div>}
      {message && <div style={s.info}>{message}</div>}

      {loading ? (
        <div style={s.muted}>Chargement…</div>
      ) : q.length >= 2 ? (
        <>
          <div style={s.sectionTitle}>
            {resultats.pdfs.length + resultats.videos.length} résultat{resultats.pdfs.length + resultats.videos.length > 1 ? 's' : ''}
          </div>
          {resultats.pdfs.length + resultats.videos.length === 0 ? (
            <div style={s.muted}>Aucun support ne correspond.</div>
          ) : (
            <div style={s.files}>
              {resultats.videos.map((v) => (
                <LigneVideo key={v.id} v={v} avecDossier racine={titre} onOuvrir={() => aller(v.dossier, { video: v.id })} />
              ))}
              {resultats.pdfs.map((f) => (
                <LigneFichier key={f.chemin} f={f} avecDossier racine={titre} onOuvrir={() => aller(f.dossier, { fichier: f.chemin })} />
              ))}
            </div>
          )}
        </>
      ) : !fichiers.length && !videos.length && !gestion ? (
        <div style={s.info}>Aucun support de formation publié pour le moment.</div>
      ) : !dossierExiste ? (
        <div style={s.info}>
          Ce dossier n’existe plus ou ne contient aucun support.{' '}
          <button type="button" style={s.btn} onClick={() => aller('')}>Retour à {titre}</button>
        </div>
      ) : (
        <>
          {sousDossiers.length > 0 && (
            <>
              <div style={s.sectionTitle}>Dossiers</div>
              <div style={s.folders}>
                {sousDossiers.map((sd, i) => {
                  const [c1, c2] = DEGRADES[(segments.length + i) % DEGRADES.length]
                  const contenu = [
                    sd.nbDossiers > 0 ? `${sd.nbDossiers} dossier${sd.nbDossiers > 1 ? 's' : ''}` : '',
                    sd.nbPdf > 0 ? `${sd.nbPdf} PDF` : '',
                    sd.nbVideos > 0 ? `${sd.nbVideos} vidéo${sd.nbVideos > 1 ? 's' : ''}` : '',
                  ].filter(Boolean)
                  return (
                    <button
                      key={sd.chemin}
                      type="button"
                      style={{ ...s.folder, background: `linear-gradient(160deg, ${c1}, ${c2})` }}
                      onClick={() => aller(sd.chemin)}
                      onMouseEnter={(e) => (e.currentTarget.style.transform = 'translateY(-3px)')}
                      onMouseLeave={(e) => (e.currentTarget.style.transform = 'none')}
                    >
                      <span style={s.folderIcon}>📁</span>
                      <h2 style={s.folderTitle}>{sd.nom}</h2>
                      <span style={s.folderSub}>
                        {contenu.join(' · ')} · MAJ {dateCourte(sd.maj)}
                      </span>
                    </button>
                  )
                })}
              </div>
            </>
          )}
          {videosIci.length > 0 && (
            <>
              <div style={s.sectionTitle}>Vidéos</div>
              <div style={s.files}>
                {videosIci.map((v) => (
                  <LigneVideo
                    key={v.id}
                    v={v}
                    racine={titre}
                    onOuvrir={() => aller(v.dossier, { video: v.id })}
                    actions={
                      gestion ? (
                        <>
                          <button type="button" style={s.btnSmall} onClick={(e) => { e.stopPropagation(); void renommer(v) }}>Renommer</button>
                          <button type="button" style={s.btnSmall} onClick={(e) => { e.stopPropagation(); void deplacer(v) }}>Déplacer</button>
                          <button type="button" style={s.btnDanger} onClick={(e) => { e.stopPropagation(); void supprimer(v) }}>Supprimer</button>
                        </>
                      ) : null
                    }
                  />
                ))}
              </div>
            </>
          )}
          {pdfs.length > 0 && (
            <>
              <div style={s.sectionTitle}>Documents</div>
              <div style={s.files}>
                {pdfs.map((f) => (
                  <LigneFichier key={f.chemin} f={f} racine={titre} onOuvrir={() => aller(f.dossier, { fichier: f.chemin })} />
                ))}
              </div>
            </>
          )}
          {!sousDossiers.length && !videosIci.length && !pdfs.length && <div style={s.muted}>Ce dossier est vide.</div>}

          {/* Dépôt de vidéos (administration) dans le dossier ouvert */}
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
                if (!envoiEnCours) void deposer(e.dataTransfer.files)
              }}
            >
              <div style={{ flex: 1, minWidth: 260 }}>
                <div style={{ fontWeight: 600, color: tc('#ffffff') }}>Déposer une vidéo dans « {nomDossierCourant} »</div>
                <div style={s.muted}>
                  Glissez ici un ou plusieurs enregistrements Teams (.mp4). Envoi par morceaux avec reprise automatique en cas de coupure ; gardez cette page ouverte jusqu’à la fin.
                </div>
                {envois.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
                    {envois.map((e, i) => {
                      const pct = e.total ? Math.min(100, Math.round((e.envoye / e.total) * 100)) : 0
                      const couleur = e.etat === 'erreur' ? '#E07A4E' : e.etat === 'ok' ? '#6DBE6A' : '#8FC7DA'
                      return (
                        <div key={`${e.nom}-${i}`}>
                          <div style={{ ...s.muted, color: tc(couleur), display: 'flex', gap: 8 }}>
                            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.nom}</span>
                            <span style={{ whiteSpace: 'nowrap' }}>
                              {e.etat === 'attente' && 'en attente'}
                              {e.etat === 'envoi' && `${formatTaille(e.envoye)} / ${formatTaille(e.total)} · ${pct} %`}
                              {e.etat === 'ok' && `déposée · ${formatTaille(e.total)}`}
                              {e.etat === 'erreur' && `échec — ${e.message ?? ''}`}
                            </span>
                          </div>
                          {(e.etat === 'envoi' || e.etat === 'ok') && (
                            <div style={s.bar}>
                              <div style={{ width: `${e.etat === 'ok' ? 100 : pct}%`, height: '100%', background: couleur, transition: 'width 0.3s' }} />
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
              <input
                ref={fileInput}
                type="file"
                accept="video/mp4,video/quicktime,video/webm,.mp4,.m4v,.mov,.webm"
                multiple
                style={{ display: 'none' }}
                onChange={(e) => {
                  void deposer(e.target.files)
                  e.target.value = ''
                }}
              />
              <button type="button" style={s.btnPrimary} disabled={envoiEnCours} onClick={() => fileInput.current?.click()}>
                {envoiEnCours ? 'Envoi en cours…' : 'Choisir une vidéo'}
              </button>
            </div>
          )}
        </>
      )}

      {!loading && etat?.message && <div style={{ ...s.muted, marginTop: 26 }}>{etat.message}</div>}
    </div>
  )
}

function LigneFichier({ f, avecDossier = false, racine, onOuvrir }: { f: FichierRow; avecDossier?: boolean; racine: string; onOuvrir: () => void }) {
  return (
    <div
      style={s.file}
      onClick={onOuvrir}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = tc('#A6A181'))}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = tc('rgba(255,255,255,0.08)'))}
    >
      <div style={s.fileIcon}>📄</div>
      <div style={{ minWidth: 0 }}>
        <div style={s.fileName}>{sansExt(f.nom)}</div>
        <div style={s.fileMeta}>
          {avecDossier ? `${f.dossier ? f.dossier.split('/').join(' › ') : racine} · ` : ''}
          PDF · {formatTaille(f.taille)} · modifié le {dateCourte(f.modifie_le)}
        </div>
      </div>
      <span style={{ ...s.muted, marginLeft: 'auto', whiteSpace: 'nowrap' }}>Ouvrir ›</span>
    </div>
  )
}

function LigneVideo({
  v,
  avecDossier = false,
  racine,
  onOuvrir,
  actions,
}: {
  v: VideoRow
  avecDossier?: boolean
  racine: string
  onOuvrir: () => void
  actions?: React.ReactNode
}) {
  const duree = formatDuree(v.duree_s)
  return (
    <div
      style={s.file}
      onClick={onOuvrir}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = tc('#A6A181'))}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = tc('rgba(255,255,255,0.08)'))}
    >
      <div style={s.fileIcon}>🎬</div>
      <div style={{ minWidth: 0 }}>
        <div style={s.fileName}>{v.titre}</div>
        <div style={s.fileMeta}>
          {avecDossier ? `${v.dossier ? v.dossier.split('/').join(' › ') : racine} · ` : ''}
          Vidéo{duree ? ` · ${duree}` : ''} · {formatTaille(v.taille)} · déposée le {dateCourte(v.created_at)}
        </div>
      </div>
      <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
        {actions}
        <span style={{ ...s.muted, whiteSpace: 'nowrap', marginLeft: 4 }}>Lire ›</span>
      </span>
    </div>
  )
}

// ── Lecteur vidéo ──────────────────────────────────────────────────────────
function LecteurVideo({
  video,
  gestion,
  onRetour,
  onRenommer,
  onDeplacer,
  onSupprimer,
}: {
  video: VideoRow
  gestion: boolean
  onRetour: () => void
  onRenommer: () => void
  onDeplacer: () => void
  onSupprimer: () => void
}) {
  const [urls, setUrls] = useState<{ key: string; voir: string | null; telecharger: string | null; error: string | null } | null>(null)
  const [erreurLecture, setErreurLecture] = useState<string | null>(null)
  const key = video.storage_path

  useEffect(() => {
    let active = true
    void (async () => {
      const bucket = supabase.storage.from(GUIDES_BUCKET)
      const [voir, tel] = await Promise.all([
        bucket.createSignedUrl(video.storage_path, GUIDES_URL_TTL),
        bucket.createSignedUrl(video.storage_path, GUIDES_URL_TTL, { download: video.nom }),
      ])
      if (!active) return
      const err = voir.error ?? tel.error
      setUrls({ key, voir: voir.data?.signedUrl ?? null, telecharger: tel.data?.signedUrl ?? null, error: err ? `Ouverture de la vidéo : ${err.message}` : null })
    })()
    return () => {
      active = false
    }
  }, [video.storage_path, video.nom, key])

  const pret = urls?.key === key ? urls : null
  const duree = formatDuree(video.duree_s)

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={s.readerBar}>
        <button type="button" style={s.btn} onClick={onRetour}>← Retour au dossier</button>
        <div style={{ fontFamily: '"Space Grotesk", system-ui, sans-serif', fontSize: 18, fontWeight: 700, color: tc('#ffffff'), minWidth: 0 }}>
          🎬 {video.titre}
          <span style={{ ...s.muted, fontWeight: 400, marginLeft: 8 }}>
            {duree ? `${duree} · ` : ''}
            {formatTaille(video.taille)}
          </span>
        </div>
        <div style={{ flex: 1 }} />
        {gestion && (
          <>
            <button type="button" style={s.btnSmall} onClick={onRenommer}>Renommer</button>
            <button type="button" style={s.btnSmall} onClick={onDeplacer}>Déplacer</button>
            <button type="button" style={s.btnDanger} onClick={onSupprimer}>Supprimer</button>
          </>
        )}
        {pret?.telecharger && (
          <a href={pret.telecharger} style={{ ...s.btn, textDecoration: 'none' }}>Télécharger</a>
        )}
      </div>

      {(pret?.error || erreurLecture) && <div style={s.error}>{pret?.error ?? erreurLecture}</div>}

      <div style={s.videoWrap}>
        {pret?.voir ? (
          <video
            key={pret.voir}
            src={pret.voir}
            controls
            playsInline
            preload="metadata"
            controlsList="nodownload"
            onError={() => setErreurLecture('Lecture impossible dans ce navigateur (format vidéo non pris en charge). Utilisez « Télécharger ».')}
            style={{ width: '100%', maxHeight: 'calc(100vh - 220px)', minHeight: 320, display: 'block', background: '#000000' }}
          />
        ) : !pret?.error ? (
          <div style={s.loading}>Chargement de la vidéo…</div>
        ) : null}
      </div>
      <div style={{ ...s.muted, marginTop: 8 }}>
        {video.nom} · déposée le {dateCourte(video.created_at)}
        {video.created_by ? ` par ${video.created_by}` : ''} · plein écran et vitesse de lecture depuis les commandes du lecteur
      </div>
    </div>
  )
}

// ── Lecteur PDF ────────────────────────────────────────────────────────────
function LecteurPdf({ fichier, onRetour }: { fichier: FichierRow; onRetour: () => void }) {
  const [urls, setUrls] = useState<{ key: string; voir: string | null; telecharger: string | null; error: string | null } | null>(null)
  const [pleinEcran, setPleinEcran] = useState(false)
  const key = fichier.storage_path

  useEffect(() => {
    let active = true
    void (async () => {
      const bucket = supabase.storage.from(GUIDES_BUCKET)
      const [voir, tel] = await Promise.all([
        bucket.createSignedUrl(fichier.storage_path, GUIDES_URL_TTL),
        bucket.createSignedUrl(fichier.storage_path, GUIDES_URL_TTL, { download: fichier.nom }),
      ])
      if (!active) return
      const err = voir.error ?? tel.error
      setUrls({ key, voir: voir.data?.signedUrl ?? null, telecharger: tel.data?.signedUrl ?? null, error: err ? `Ouverture du document : ${err.message}` : null })
    })()
    return () => {
      active = false
    }
  }, [fichier.storage_path, fichier.nom, key])

  useEffect(() => {
    if (!pleinEcran) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPleinEcran(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pleinEcran])

  const pret = urls?.key === key ? urls : null
  const conteneur: React.CSSProperties = pleinEcran
    ? { position: 'fixed', inset: 0, zIndex: 1000, background: tc('#0B1220'), padding: 10, display: 'flex', flexDirection: 'column' }
    : { display: 'flex', flexDirection: 'column' }

  return (
    <div style={conteneur}>
      <div style={s.readerBar}>
        {!pleinEcran && <button type="button" style={s.btn} onClick={onRetour}>← Retour au dossier</button>}
        <div style={{ fontFamily: '"Space Grotesk", system-ui, sans-serif', fontSize: 18, fontWeight: 700, color: tc('#ffffff'), minWidth: 0 }}>
          📄 {sansExt(fichier.nom)}
          <span style={{ ...s.muted, fontWeight: 400, marginLeft: 8 }}>{formatTaille(fichier.taille)}</span>
        </div>
        <div style={{ flex: 1 }} />
        {pret?.voir && (
          <a href={pret.voir} target="_blank" rel="noopener noreferrer" style={{ ...s.btn, textDecoration: 'none' }}>Nouvel onglet ↗</a>
        )}
        {pret?.telecharger && (
          <a href={pret.telecharger} style={{ ...s.btnPrimary, textDecoration: 'none' }}>Télécharger</a>
        )}
        <button type="button" style={s.btn} onClick={() => setPleinEcran((v) => !v)}>
          {pleinEcran ? 'Quitter le plein écran (Échap)' : 'Plein écran'}
        </button>
      </div>

      {pret?.error && <div style={s.error}>{pret.error}</div>}

      <div style={{ ...s.frameWrap, ...(pleinEcran ? { flex: 1 } : {}) }}>
        {pret?.voir ? (
          <iframe
            key={pret.voir}
            title={fichier.nom}
            src={pret.voir}
            style={{ width: '100%', height: pleinEcran ? '100%' : 'calc(100vh - 170px)', minHeight: 480, border: 0, display: 'block', background: '#525659' }}
          />
        ) : !pret?.error ? (
          <div style={s.loading}>Chargement du document…</div>
        ) : null}
      </div>
    </div>
  )
}
