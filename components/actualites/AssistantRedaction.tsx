'use client'

// ============================================================================
// components/actualites/AssistantRedaction.tsx — Assistant IA de l'éditeur
// du fil d'actualité (14/10/2026)
// ----------------------------------------------------------------------------
// Le rédacteur colle un mail (ou un texte), écrit ses consignes en quelques
// mots, ajoute des photos / impressions d'écran (glisser, coller, choisir) et
// clique « Proposer une mise en forme ». La route /api/actualites/assistant
// renvoie titre, catégorie, résumé, blocs et points à vérifier ; l'éditeur
// les reprend, le rédacteur relit et publie.
//
// Images : chacune est envoyée au bucket « actualites » (pour pouvoir être
// insérée dans la publication) et, réduite à 1 600 px, à l'IA qui la lit.
// Rôle par image : l'IA décide / photo à insérer / capture à lire (convertie
// en tableau, pas insérée) / capture à insérer.
// PDF (mail imprimé en PDF, fiche produit…) : son texte est ajouté au champ
// « Mail ou texte source » et ses premières pages partent comme captures à
// lire (pdf.js chargé à la demande depuis cdnjs, comme le contrôle des pièces CEE).
// ============================================================================

import { useCallback, useRef, useState } from 'react'
import type React from 'react'
import { supabase } from '@/lib/supabaseClient'
import { uploadActualiteImage, type ActualiteType, type Block } from '@/lib/actualites'

type Role = 'auto' | 'photo' | 'capture_lire' | 'capture_inserer'

type ImageSource = {
  id: string
  nom: string
  role: Role
  apercu: string
  dataUrl: string
  path: string | null
  erreur?: string
}

export type PropositionIA = {
  titre: string
  categorie: string
  resume: string
  bandeauJours: number
  blocks: Block[]
  pointsAVerifier: string[]
}

const ROLES: { value: Role; label: string }[] = [
  { value: 'auto', label: 'L’IA décide' },
  { value: 'photo', label: 'Photo à insérer' },
  { value: 'capture_lire', label: 'Capture à lire (tableau, chiffres)' },
  { value: 'capture_inserer', label: 'Capture à insérer telle quelle' },
]

const MAX_IMAGES = 8
const MAX_PAGES_PDF = 4
const PDF_JS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js'
const PDF_WORKER_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'

type PdfJs = {
  GlobalWorkerOptions: { workerSrc: string }
  getDocument: (src: { data: Uint8Array }) => { promise: Promise<PdfDoc> }
}
type PdfDoc = { numPages: number; getPage: (n: number) => Promise<PdfPage> }
type PdfPage = {
  getTextContent: () => Promise<{ items: Array<{ str?: string; hasEOL?: boolean }> }>
  getViewport: (o: { scale: number }) => { width: number; height: number }
  render: (o: { canvasContext: CanvasRenderingContext2D; viewport: unknown }) => { promise: Promise<void> }
}

async function chargerPdfJs(): Promise<PdfJs> {
  const w = window as unknown as { pdfjsLib?: PdfJs }
  if (!w.pdfjsLib && !document.querySelector(`script[src="${PDF_JS_URL}"]`)) {
    const script = document.createElement('script')
    script.src = PDF_JS_URL
    script.async = true
    document.head.appendChild(script)
  }
  for (let i = 0; i < 80; i += 1) {
    if (w.pdfjsLib) {
      if (!w.pdfjsLib.GlobalWorkerOptions.workerSrc) w.pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER_URL
      return w.pdfjsLib
    }
    await new Promise((r) => window.setTimeout(r, 250))
  }
  throw new Error('Lecteur PDF indisponible (vérifiez la connexion et rechargez la page).')
}

/** Texte du PDF + images des premières pages (JPEG). */
async function lirePdf(file: File): Promise<{ texte: string; pages: File[] }> {
  const pdfjs = await chargerPdfJs()
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise
  const textes: string[] = []
  const pages: File[] = []
  for (let n = 1; n <= pdf.numPages; n += 1) {
    const page = await pdf.getPage(n)
    const tc = await page.getTextContent()
    textes.push(tc.items.map((it) => (it.str || '') + (it.hasEOL ? '\n' : ' ')).join(''))
    if (n <= MAX_PAGES_PDF) {
      const vp1 = page.getViewport({ scale: 1 })
      const vp = page.getViewport({ scale: Math.min(2, 1500 / vp1.width) })
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(vp.width)
      canvas.height = Math.round(vp.height)
      const ctx = canvas.getContext('2d')
      if (!ctx) continue
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      await page.render({ canvasContext: ctx, viewport: vp }).promise
      const blob: Blob = await new Promise((resolve) => canvas.toBlob((b) => resolve(b as Blob), 'image/jpeg', 0.85))
      pages.push(new File([blob], `${file.name.replace(/\.pdf$/i, '')} – page ${n}.jpg`, { type: 'image/jpeg' }))
    }
  }
  const texte = textes
    .join('\n')
    .replace(/[ \t]+/g, ' ')
    // PDF « imprimés » depuis Outlook (macOS) : libellés répétés (« Objet: Objet: Objet: »).
    .replace(/([A-Za-zÀ-ÿ’']+ ?:)(?: \1)+/g, '$1')
    .trim()
  return { texte, pages }
}

/** Réduit une image à 1 600 px de côté max (JPEG 85 %) pour l'envoi à l'IA. */
async function reduire(file: File): Promise<string> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = reject
      el.src = url
    })
    const scale = Math.min(1, 1600 / Math.max(img.width, img.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(img.width * scale))
    canvas.height = Math.max(1, Math.round(img.height * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.85)
  } finally {
    URL.revokeObjectURL(url)
  }
}

const accepte = (type: string) => type.startsWith('image/') || type === 'application/pdf'

function imagesDepuis(list: DataTransferItemList | FileList | null | undefined): File[] {
  if (!list) return []
  const files: File[] = []
  for (const item of Array.from(list as ArrayLike<DataTransferItem | File>)) {
    if (item instanceof File) {
      if (accepte(item.type)) files.push(item)
    } else if (item.kind === 'file' && accepte(item.type)) {
      const f = item.getAsFile()
      if (f) files.push(f)
    }
  }
  return files
}

export default function AssistantRedaction({
  type,
  contenuExistant,
  onApply,
}: {
  type: ActualiteType
  /** true si l'éditeur contient déjà du texte : on demande confirmation avant de remplacer. */
  contenuExistant: boolean
  onApply: (proposition: PropositionIA) => void
}) {
  const [ouvert, setOuvert] = useState(true)
  const [texte, setTexte] = useState('')
  const [consignes, setConsignes] = useState('')
  const [images, setImages] = useState<ImageSource[]>([])
  const [enCours, setEnCours] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
  const [points, setPoints] = useState<string[]>([])
  const [survol, setSurvol] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const [lecturePdf, setLecturePdf] = useState(false)

  const ajouter = useCallback(async (entrants: File[]) => {
    // PDF : texte ajouté au champ source, pages converties en captures à lire.
    const files: Array<{ file: File; role: Role }> = []
    for (const f of entrants) {
      if (f.type !== 'application/pdf') {
        files.push({ file: f, role: 'auto' })
        continue
      }
      setLecturePdf(true)
      try {
        const { texte: t, pages } = await lirePdf(f)
        if (t) setTexte((cur) => `${cur.trim() ? `${cur.trim()}\n\n` : ''}--- ${f.name} ---\n${t}`)
        pages.forEach((page) => files.push({ file: page, role: 'capture_lire' }))
      } catch (err) {
        setErreur(`Lecture du PDF « ${f.name} » impossible : ${(err as Error)?.message || err}`)
      } finally {
        setLecturePdf(false)
      }
    }
    const place = MAX_IMAGES - images.length
    const lot = files.slice(0, Math.max(0, place))
    if (files.length > lot.length) setErreur(`${MAX_IMAGES} images au maximum (pages de PDF comprises).`)
    for (const { file, role } of lot) {
      const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`
      const apercu = URL.createObjectURL(file)
      setImages((cur) => [...cur, { id, nom: file.name || 'image collée', role, apercu, dataUrl: '', path: null }])
      try {
        const [dataUrl, path] = await Promise.all([reduire(file), uploadActualiteImage(file, file.name)])
        setImages((cur) => cur.map((img) => (img.id === id ? { ...img, dataUrl, path } : img)))
      } catch (err) {
        setImages((cur) => cur.map((img) => (img.id === id ? { ...img, erreur: `Envoi impossible : ${(err as Error)?.message || err}` } : img)))
      }
    }
  }, [images.length])

  const retirer = (id: string) =>
    setImages((cur) => {
      const img = cur.find((x) => x.id === id)
      if (img) URL.revokeObjectURL(img.apercu)
      return cur.filter((x) => x.id !== id)
    })

  const pret = images.every((img) => img.dataUrl && img.path) && (texte.trim() || images.length > 0)

  const proposer = async () => {
    if (!pret || enCours) return
    if (contenuExistant && !window.confirm('Remplacer le titre et le contenu actuels par la proposition de l’assistant ?')) return
    setEnCours(true)
    setErreur(null)
    setPoints([])
    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData.session?.access_token
      if (!token) throw new Error('Session expirée : reconnectez-vous.')
      const res = await fetch('/api/actualites/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          type,
          texte,
          consignes,
          images: images.map((img) => ({ dataUrl: img.dataUrl, role: img.role, nom: img.nom })),
        }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data) throw new Error(data?.error || `Erreur ${res.status}`)

      // Les blocs image de l'IA désignent une image par son numéro : on les
      // relie aux fichiers déjà envoyés dans le bucket.
      const blocks: Block[] = (data.blocks as Array<Record<string, unknown>>)
        .map((b) => {
          if (b.type === 'image') {
            const img = images[Number(b.image)]
            return img?.path ? ({ type: 'image', path: img.path, caption: String(b.caption || '') } as Block) : null
          }
          return b as unknown as Block
        })
        .filter((b): b is Block => Boolean(b))

      setPoints(Array.isArray(data.points_a_verifier) ? data.points_a_verifier : [])
      onApply({
        titre: String(data.titre || ''),
        categorie: String(data.categorie || ''),
        resume: String(data.resume || ''),
        bandeauJours: Number(data.bandeau_jours) || 7,
        blocks,
        pointsAVerifier: Array.isArray(data.points_a_verifier) ? data.points_a_verifier : [],
      })
    } catch (err) {
      setErreur((err as Error)?.message || String(err))
    } finally {
      setEnCours(false)
    }
  }

  return (
    <section style={styles.panel} aria-label="Assistant de rédaction">
      <button type="button" onClick={() => setOuvert((v) => !v)} style={styles.head} aria-expanded={ouvert}>
        <span style={styles.headIcon} aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3l1.8 4.6 4.7 1.9-4.7 1.9L12 16l-1.8-4.6-4.7-1.9 4.7-1.9z" />
            <path d="M19 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" />
          </svg>
        </span>
        <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
          <span style={styles.title}>Assistant de rédaction</span>
          <span style={styles.subtitle}>Collez un mail, dites ce que vous voulez, ajoutez photos et captures : l’IA propose la mise en forme.</span>
        </span>
        <span style={styles.chevron} aria-hidden="true">{ouvert ? '−' : '+'}</span>
      </button>

      {ouvert ? (
        <div style={styles.body}>
          <label style={styles.field}>
            Mail ou texte source
            <textarea
              value={texte}
              onChange={(e) => setTexte(e.target.value)}
              onPaste={(e) => {
                const files = imagesDepuis(e.clipboardData?.items)
                if (files.length) {
                  e.preventDefault()
                  void ajouter(files)
                }
              }}
              placeholder="Collez ici le mail (Outlook : tout sélectionner, copier) ou le texte d’origine. Les tableaux copiés depuis Outlook ou Excel sont repris."
              rows={7}
              style={styles.textarea}
            />
          </label>

          <label style={styles.field}>
            Vos consignes
            <textarea
              value={consignes}
              onChange={(e) => setConsignes(e.target.value)}
              placeholder="Ex. : premier « Dispo » Air-Eau pour les commerciaux ; mettre en avant les gros stocks à pousser et rappeler que les CDC enregistrées sont prioritaires. Photo de l’AirH2O 600 en tête."
              rows={3}
              style={styles.textarea}
            />
          </label>

          <div
            style={{ ...styles.drop, ...(survol ? styles.dropActive : {}) }}
            onDragOver={(e) => {
              e.preventDefault()
              setSurvol(true)
            }}
            onDragLeave={() => setSurvol(false)}
            onDrop={(e) => {
              e.preventDefault()
              setSurvol(false)
              void ajouter(imagesDepuis(e.dataTransfer.files))
            }}
          >
            <span>{lecturePdf ? 'Lecture du PDF…' : 'Photos, impressions d’écran ou PDF du mail : glissez-les ici, collez les images (Ctrl + V) dans le champ du mail, ou'}</span>
            <button type="button" onClick={() => inputRef.current?.click()} style={styles.linkButton}>
              choisissez des fichiers
            </button>
            <input
              ref={inputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif,application/pdf"
              multiple
              style={{ display: 'none' }}
              onChange={(e) => {
                void ajouter(imagesDepuis(e.target.files))
                e.target.value = ''
              }}
            />
          </div>

          {images.length > 0 ? (
            <div style={styles.thumbs}>
              {images.map((img, i) => (
                <div key={img.id} style={styles.thumb}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img.apercu} alt={img.nom} style={styles.thumbImg} />
                  <div style={styles.thumbInfo}>
                    <span style={styles.thumbName}>
                      Image {i + 1} · {img.erreur ? <span style={{ color: 'var(--cg-danger)' }}>{img.erreur}</span> : img.path ? 'prête' : 'envoi…'}
                    </span>
                    <select
                      value={img.role}
                      onChange={(e) => setImages((cur) => cur.map((x) => (x.id === img.id ? { ...x, role: e.target.value as Role } : x)))}
                      style={styles.select}
                      aria-label={`Rôle de l’image ${i + 1}`}
                    >
                      {ROLES.map((r) => (
                        <option key={r.value} value={r.value}>{r.label}</option>
                      ))}
                    </select>
                  </div>
                  <button type="button" onClick={() => retirer(img.id)} style={styles.remove} aria-label={`Retirer l’image ${i + 1}`}>✕</button>
                </div>
              ))}
            </div>
          ) : null}

          <div style={styles.actions}>
            <button type="button" onClick={() => void proposer()} disabled={!pret || enCours} style={{ ...styles.primary, ...(!pret || enCours ? styles.disabled : {}) }}>
              {enCours ? 'Rédaction en cours… (jusqu’à une minute)' : 'Proposer une mise en forme'}
            </button>
            <span style={styles.hint}>La proposition remplit l’éditeur ci-dessous : relisez les chiffres avant de publier.</span>
          </div>

          {erreur ? <div style={styles.error} role="alert">{erreur}</div> : null}

          {points.length > 0 ? (
            <div style={styles.points} role="status">
              <div style={styles.pointsTitle}>Points à vérifier avant de publier</div>
              <ul style={styles.pointsList}>
                {points.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}

const styles: Record<string, React.CSSProperties> = {
  panel: {
    borderRadius: 16,
    border: '1px solid rgba(193,104,60,0.45)',
    background: 'linear-gradient(180deg, rgba(193,104,60,0.10), rgba(193,104,60,0.03))',
    color: 'var(--cg-ink)',
    fontFamily: 'var(--font-body)',
  },
  head: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    width: '100%',
    padding: '14px 16px',
    border: 'none',
    background: 'transparent',
    color: 'inherit',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  headIcon: {
    width: 38,
    height: 38,
    borderRadius: 11,
    background: 'rgba(193,104,60,0.22)',
    color: '#C1683C',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  title: {
    display: 'block',
    fontFamily: 'var(--font-display)',
    fontSize: 17,
    fontWeight: 700,
  },
  subtitle: {
    display: 'block',
    marginTop: 2,
    fontSize: 13,
    color: 'rgba(var(--cg-ink-rgb), 0.65)',
  },
  chevron: {
    fontSize: 22,
    color: 'rgba(var(--cg-ink-rgb), 0.5)',
  },
  body: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    padding: '0 16px 16px',
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    fontSize: 13,
    fontWeight: 600,
    color: 'rgba(var(--cg-ink-rgb), 0.78)',
  },
  textarea: {
    width: '100%',
    boxSizing: 'border-box',
    padding: '10px 12px',
    borderRadius: 9,
    border: '1px solid rgba(var(--cg-ink-rgb), 0.18)',
    background: 'var(--cg-surface)',
    color: 'var(--cg-ink)',
    fontFamily: 'inherit',
    fontSize: 14,
    fontWeight: 400,
    lineHeight: 1.5,
    resize: 'vertical',
  },
  drop: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    padding: '14px 16px',
    borderRadius: 10,
    border: '1px dashed rgba(var(--cg-ink-rgb), 0.3)',
    fontSize: 13.5,
    color: 'rgba(var(--cg-ink-rgb), 0.7)',
  },
  dropActive: {
    borderColor: 'var(--cg-accent)',
    background: 'var(--cg-accent-bg)',
  },
  linkButton: {
    border: 'none',
    background: 'transparent',
    padding: 0,
    color: 'var(--cg-accent)',
    fontSize: 13.5,
    fontWeight: 600,
    cursor: 'pointer',
    textDecoration: 'underline',
  },
  thumbs: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
    gap: 8,
  },
  thumb: {
    position: 'relative',
    display: 'flex',
    gap: 10,
    alignItems: 'center',
    padding: 8,
    borderRadius: 10,
    border: '1px solid rgba(var(--cg-ink-rgb), 0.14)',
    background: 'var(--cg-surface)',
  },
  thumbImg: {
    width: 64,
    height: 64,
    objectFit: 'cover',
    borderRadius: 6,
    flexShrink: 0,
    background: 'rgba(var(--cg-ink-rgb), 0.06)',
  },
  thumbInfo: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    minWidth: 0,
    flex: 1,
  },
  thumbName: {
    fontSize: 12,
    color: 'rgba(var(--cg-ink-rgb), 0.65)',
  },
  select: {
    padding: '6px 8px',
    borderRadius: 7,
    border: '1px solid rgba(var(--cg-ink-rgb), 0.18)',
    background: 'var(--cg-surface)',
    color: 'var(--cg-ink)',
    fontFamily: 'inherit',
    fontSize: 12.5,
  },
  remove: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 26,
    height: 26,
    borderRadius: 7,
    border: '1px solid rgba(var(--cg-ink-rgb), 0.16)',
    background: 'var(--cg-surface)',
    color: 'rgba(var(--cg-ink-rgb), 0.7)',
    cursor: 'pointer',
    fontSize: 11,
  },
  actions: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 12,
  },
  primary: {
    padding: '11px 18px',
    borderRadius: 9,
    border: 'none',
    background: '#A9542C',
    color: '#FFFFFE',
    fontFamily: 'inherit',
    fontSize: 14,
    fontWeight: 700,
    cursor: 'pointer',
  },
  disabled: {
    opacity: 0.55,
    cursor: 'default',
  },
  hint: {
    fontSize: 12.5,
    color: 'rgba(var(--cg-ink-rgb), 0.6)',
  },
  error: {
    padding: '10px 12px',
    borderRadius: 9,
    border: '1px solid var(--cg-danger-border)',
    background: 'var(--cg-danger-bg)',
    color: 'var(--cg-danger-text)',
    fontSize: 13.5,
  },
  points: {
    padding: '12px 14px',
    borderRadius: 10,
    border: '1px solid var(--cg-warn)',
    background: 'rgba(214,154,74,0.10)',
    fontSize: 13.5,
    lineHeight: 1.5,
  },
  pointsTitle: {
    fontWeight: 700,
    marginBottom: 4,
    color: 'var(--cg-warn-ink)',
  },
  pointsList: {
    margin: 0,
    paddingLeft: 18,
  },
}
