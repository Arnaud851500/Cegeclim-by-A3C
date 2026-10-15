'use client'

// ============================================================================
// app/actualites/editer/page.tsx — Publier / modifier une actualité ou une
// nouveauté du compagnon (13/10/2026)
// ----------------------------------------------------------------------------
// Réservé aux rédacteurs (administrateurs + table actualites_redacteurs ; le
// RLS refuse de toute façon l'écriture aux autres).
//   ?id=<uuid>          → modification
//   ?type=nouveaute     → nouvelle nouveauté du compagnon (sinon actualité)
// ÉVOLUTION (2026-10-14) : choix « Afficher sur : PC / Mobile » (colonne
// plateformes ; au moins une case cochée, les deux par défaut).
// ÉVOLUTION (2026-10-14) : « Assistant de rédaction » (IA) en tête d'écran :
// mail collé + consignes + photos / captures → proposition complète (titre,
// catégorie, résumé, blocs, durée dans le bandeau) via
// /api/actualites/assistant ; le rédacteur relit puis publie.
// Le contenu se compose de blocs : paragraphe, intertitre, liste, tableau,
// image, encadré, lien. Raccourcis :
//   - coller une impression d'écran (Ctrl+V) dans un paragraphe ou la
//     déposer sur l'éditeur → bloc image (bucket privé « actualites ») ;
//   - coller une plage Excel dans un paragraphe → bloc tableau ;
//   - dans le texte : **gras**, *italique*, [libellé](https://… ou /chemin).
// ÉVOLUTION (2026-10-15) : bloc « Tableau stock en direct » — titre, liste de
// références avec une remarque par ligne (« RÉF ; remarque »), colonnes à
// afficher ; les chiffres sont lus dans SAGE à chaque lecture et le titre
// ouvre l'écran Stock sur le groupe d'articles du même nom, créé à la
// publication. Un tableau existant dont la 1re colonne contient des
// références se convertit en un clic (« → Tableau stock en direct ») : le
// titre reprend l'intertitre qui le précède, les mentions textuelles des
// cellules (bonne affaire, allocation, sav…) deviennent les remarques.
// ============================================================================

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type React from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { useAccess } from '@/components/AccessContext'
import ActualiteContent from '@/components/actualites/ActualiteContent'
import AssistantRedaction, { type PropositionIA } from '@/components/actualites/AssistantRedaction'
import {
  ACTUALITE_CATEGORIES,
  ACTUALITES_PATH,
  PLATEFORMES_DEFAUT,
  fetchActualite,
  notifyActualitesChanged,
  STOCK_COLONNES,
  STOCK_COLONNES_DEFAUT,
  safeUrl,
  stockBlockGroupe,
  uploadActualiteImage,
  usePeutPublier,
  useSignedImages,
  type ActualiteStatut,
  type ActualiteType,
  type Plateforme,
  type Block,
  type BlockType,
  type StockBlock,
  type StockColonne,
} from '@/lib/actualites'

type EditorBlock = Block & { _k: string }

let keySeq = 0
const newKey = () => `b${Date.now().toString(36)}${(keySeq++).toString(36)}`

const BLOCK_LABELS: Record<BlockType, string> = {
  paragraph: 'Paragraphe',
  heading: 'Intertitre',
  list: 'Liste',
  table: 'Tableau',
  image: 'Image',
  callout: 'Encadré',
  link: 'Lien',
  stock: 'Tableau stock en direct',
}

function emptyBlock(type: BlockType): EditorBlock {
  switch (type) {
    case 'paragraph':
      return { type, text: '', _k: newKey() }
    case 'heading':
      return { type, text: '', _k: newKey() }
    case 'list':
      return { type, items: [''], ordered: false, _k: newKey() }
    case 'table':
      return { type, header: true, rows: [['', '', ''], ['', '', ''], ['', '', '']], _k: newKey() }
    case 'image':
      return { type, path: '', caption: '', _k: newKey() }
    case 'callout':
      return { type, title: 'Ce qui est attendu de vous', text: '', tone: 'info', _k: newKey() }
    case 'link':
      return { type, label: '', url: '', _k: newKey() }
    case 'stock':
      return { type, titre: '', lignes: [], colonnes: [...STOCK_COLONNES_DEFAUT], _k: newKey() }
  }
}

// ── Tableau stock : texte « RÉF ; remarque » ⇄ lignes ───────────────────────
function lignesVersTexte(lignes: StockBlock['lignes']) {
  return (lignes || []).map((l) => (l.note ? `${l.ref} ; ${l.note}` : l.ref)).join('\n')
}

function texteVersLignes(texte: string): StockBlock['lignes'] {
  return texte
    .split('\n')
    .map((line) => {
      const m = /^\s*([^\s;|\t]+)\s*(?:[;|\t]\s*(.*))?$/.exec(line)
      if (!m) return null
      const note = (m[2] || '').trim()
      return note ? { ref: m[1].toUpperCase(), note } : { ref: m[1].toUpperCase() }
    })
    .filter((l): l is { ref: string; note?: string } => Boolean(l))
}

const REF_ARTICLE_RE = /^[A-Z0-9][A-Z0-9.\-/_]*[0-9][A-Z0-9.\-/_]*$/i

/** Tableau saisi → bloc stock en direct (null si la 1re colonne ne contient pas de références). */
function tableVersStock(table: Extract<Block, { type: 'table' }>, titre: string): StockBlock | null {
  const rows = table.rows.filter((r) => r.some((c) => String(c || '').trim()))
  const head = table.header !== false ? rows[0] || [] : []
  const body = table.header !== false ? rows.slice(1) : rows
  const lignes: StockBlock['lignes'] = []
  for (const row of body) {
    const ref = String(row[0] || '').trim()
    if (!REF_ARTICLE_RE.test(ref)) continue
    const notes: string[] = []
    row.forEach((cell, c) => {
      if (c === 0) return
      const entete = String(head[c] || '').trim()
      if (/d[ée]signation/i.test(entete)) return
      let v = String(cell || '').replace(/→\s*arrivage/gi, '').replace(/\s+/g, ' ').trim()
      if (!/[a-zà-ÿ]/i.test(v)) return
      if (/^dispo/i.test(entete)) {
        v = v.replace(/^[−\-+]?\s*\d+([.,]\d+)?\s*/, '').replace(/^[·\s]+|[·\s]+$/g, '').trim()
        if (v) notes.push(v)
      } else {
        notes.push(entete ? `${entete.toLowerCase()} : ${v}` : v)
      }
    })
    lignes.push(notes.length ? { ref: ref.toUpperCase(), note: notes.join(' · ') } : { ref: ref.toUpperCase() })
  }
  if (lignes.length === 0) return null
  return { type: 'stock', titre: titre || 'Tableau stock', lignes, colonnes: [...STOCK_COLONNES_DEFAUT] }
}

function StockEditor({ block, onChange }: { block: StockBlock; onChange: (b: Partial<StockBlock>) => void }) {
  // Texte saisi gardé localement : la saisie reste libre (lignes vides, ; en cours de frappe).
  const [texte, setTexte] = useState(() => lignesVersTexte(block.lignes))
  const colonnes = block.colonnes && block.colonnes.length > 0 ? block.colonnes : STOCK_COLONNES_DEFAUT
  const nbRefs = new Set((block.lignes || []).map((l) => l.ref)).size
  const groupe = stockBlockGroupe(block)

  const toggleColonne = (key: StockColonne, on: boolean) => {
    const next = on ? [...colonnes.filter((c) => c !== key), key] : colonnes.filter((c) => c !== key)
    onChange({ colonnes: STOCK_COLONNES.map((c) => c.key).filter((k) => next.includes(k)) })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={styles.inlineTools}>
        <input
          value={block.titre}
          onChange={(e) => onChange({ titre: e.target.value })}
          placeholder="Titre affiché (ex. Yutaki H Combi — promo en cours)"
          style={{ ...styles.input, ...styles.headingInput, flex: '1 1 320px' }}
          aria-label="Titre du tableau stock"
        />
        <input
          value={block.groupe || ''}
          onChange={(e) => onChange({ groupe: e.target.value })}
          placeholder="Nom du groupe (facultatif, sinon le titre)"
          style={{ ...styles.input, flex: '1 1 220px' }}
          aria-label="Nom du groupe d’articles"
        />
      </div>
      <AutoTextarea
        value={texte}
        onChange={(e) => {
          setTexte(e.target.value)
          onChange({ lignes: texteVersLignes(e.target.value) })
        }}
        placeholder={'Une référence par ligne, remarque facultative après « ; »\nRAS-4HVRC2E ; allocation\nHWD-WE-220S ; + 1 bonne affaire'}
        style={{ fontFamily: 'var(--font-mono)', fontSize: 13.5 }}
        aria-label="Références du tableau stock"
      />
      <div style={styles.inlineTools}>
        <span style={styles.hint}>Colonnes :</span>
        {STOCK_COLONNES.map((c) => (
          <label key={c.key} style={styles.check}>
            <input type="checkbox" checked={colonnes.includes(c.key)} onChange={(e) => toggleColonne(c.key, e.target.checked)} />
            {c.label}
          </label>
        ))}
      </div>
      <span style={styles.hint}>
        {nbRefs} référence{nbRefs > 1 ? 's' : ''} · Dispo, stock et arrivages lus dans SAGE à chaque lecture (Dispo = stock − CDC − PL).
        {groupe ? ` À la publication, le groupe « ${groupe} » est créé dans l’écran Stock et le titre y renvoie.` : ' Donnez un titre : il devient le nom du groupe d’articles.'}
      </span>
    </div>
  )
}

function stripKeys(blocks: EditorBlock[]): Block[] {
  return blocks.map((block) => {
    const { _k, ...rest } = block
    void _k
    return rest as Block
  })
}

/** Plage copiée depuis Excel / un tableau : lignes séparées par \n, cellules par \t. */
function parseTsv(text: string): string[][] | null {
  if (!text.includes('\t')) return null
  const lines = text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n')
  if (lines.length < 1) return null
  const rows = lines.map((line) => line.split('\t'))
  const width = Math.max(...rows.map((r) => r.length))
  if (width < 2) return null
  return rows.map((r) => [...r, ...Array(width - r.length).fill('')])
}

function toLocalInput(iso: string | null | undefined) {
  const d = iso ? new Date(iso) : new Date()
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function todayPlus(days: number) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function imageFileFrom(items: DataTransferItemList | null | undefined): File | null {
  if (!items) return null
  for (const item of Array.from(items)) {
    if (item.kind === 'file' && item.type.startsWith('image/')) return item.getAsFile()
  }
  return null
}

// ── Éditeurs de blocs ────────────────────────────────────────────────────────
function AutoTextarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement | null>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight + 2}px`
  }, [props.value])
  return <textarea ref={ref} rows={2} {...props} style={{ ...styles.textarea, ...(props.style || {}) }} />
}

function TableEditor({ block, onChange }: { block: Extract<Block, { type: 'table' }>; onChange: (b: Partial<Extract<Block, { type: 'table' }>>) => void }) {
  const rows = block.rows.length ? block.rows : [['']]
  const width = Math.max(...rows.map((r) => r.length))

  const setCell = (r: number, c: number, value: string) => {
    const next = rows.map((row) => [...row])
    next[r][c] = value
    onChange({ rows: next })
  }

  const pasteInto = (r: number, c: number, event: React.ClipboardEvent<HTMLInputElement>) => {
    const grid = parseTsv(event.clipboardData.getData('text/plain'))
    if (!grid) return
    event.preventDefault()
    const height = Math.max(rows.length, r + grid.length)
    const w = Math.max(width, c + grid[0].length)
    const next = Array.from({ length: height }, (_, i) => Array.from({ length: w }, (_, j) => rows[i]?.[j] ?? ''))
    grid.forEach((line, i) => line.forEach((cell, j) => (next[r + i][c + j] = cell.trim())))
    onChange({ rows: next })
  }

  return (
    <div>
      <div style={styles.tableGridWrap}>
        <table style={styles.tableGrid}>
          <tbody>
            {rows.map((row, r) => (
              <tr key={r}>
                {Array.from({ length: width }, (_, c) => (
                  <td key={c} style={styles.tableGridCell}>
                    <input
                      value={row[c] ?? ''}
                      onChange={(e) => setCell(r, c, e.target.value)}
                      onPaste={(e) => pasteInto(r, c, e)}
                      aria-label={`Ligne ${r + 1}, colonne ${c + 1}`}
                      style={{ ...styles.cellInput, ...(r === 0 && block.header !== false ? styles.cellHead : {}) }}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={styles.inlineTools}>
        <button type="button" style={styles.miniBtn} onClick={() => onChange({ rows: [...rows.map((r) => [...r]), Array(width).fill('')] })}>+ ligne</button>
        <button type="button" style={styles.miniBtn} onClick={() => onChange({ rows: rows.map((r) => [...r, '']) })}>+ colonne</button>
        <button type="button" style={styles.miniBtn} disabled={rows.length <= 1} onClick={() => onChange({ rows: rows.slice(0, -1) })}>− ligne</button>
        <button type="button" style={styles.miniBtn} disabled={width <= 1} onClick={() => onChange({ rows: rows.map((r) => r.slice(0, width - 1)) })}>− colonne</button>
        <label style={styles.check}>
          <input type="checkbox" checked={block.header !== false} onChange={(e) => onChange({ header: e.target.checked })} />
          1re ligne = en-tête
        </label>
        <span style={styles.hint}>Astuce : collez une plage Excel dans une cellule.</span>
      </div>
    </div>
  )
}

function ImageEditor({
  block,
  onChange,
  onUpload,
}: {
  block: Extract<Block, { type: 'image' }>
  onChange: (b: Partial<Extract<Block, { type: 'image' }>>) => void
  onUpload: (file: File) => Promise<string | null>
}) {
  const urls = useSignedImages(block.path ? [block.path] : [])
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [uploading, setUploading] = useState(false)

  const pick = async (file: File | null | undefined) => {
    if (!file) return
    setUploading(true)
    const path = await onUpload(file)
    setUploading(false)
    if (path) onChange({ path })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {block.path && urls[block.path] ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={urls[block.path]} alt={block.caption || 'Impression d’écran'} style={styles.imagePreview} />
      ) : (
        <div
          style={styles.dropZone}
          onPaste={(e) => {
            const file = imageFileFrom(e.clipboardData?.items)
            if (file) {
              e.preventDefault()
              void pick(file)
            }
          }}
          tabIndex={0}
        >
          {uploading ? 'Envoi de l’image…' : 'Collez une impression d’écran ici (Ctrl + V) ou choisissez un fichier.'}
        </div>
      )}
      <div style={styles.inlineTools}>
        <button type="button" style={styles.miniBtn} onClick={() => inputRef.current?.click()} disabled={uploading}>
          {block.path ? 'Remplacer l’image' : 'Choisir un fichier'}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          style={{ display: 'none' }}
          onChange={(e) => void pick(e.target.files?.[0])}
        />
        <input
          value={block.caption || ''}
          onChange={(e) => onChange({ caption: e.target.value })}
          placeholder="Légende (facultatif)"
          style={{ ...styles.input, flex: '1 1 240px' }}
          aria-label="Légende de l’image"
        />
      </div>
    </div>
  )
}

function BlockEditor({
  block,
  index,
  count,
  onChange,
  onMove,
  onRemove,
  onInsertAfter,
  onUpload,
  onConvertStock,
}: {
  block: EditorBlock
  index: number
  count: number
  onChange: (patch: Partial<Block>) => void
  onMove: (delta: number) => void
  onRemove: () => void
  onInsertAfter: (blocks: EditorBlock[]) => void
  /** Tableau → tableau stock en direct (absent si la conversion est impossible). */
  onConvertStock?: () => void
  onUpload: (file: File) => Promise<string | null>
}) {
  const onParagraphPaste = async (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const file = imageFileFrom(event.clipboardData?.items)
    if (file) {
      event.preventDefault()
      const path = await onUpload(file)
      if (path) onInsertAfter([{ type: 'image', path, caption: '', _k: newKey() }])
      return
    }
    const grid = parseTsv(event.clipboardData.getData('text/plain'))
    if (grid && grid.length >= 2) {
      event.preventDefault()
      onInsertAfter([{ type: 'table', header: true, rows: grid.map((r) => r.map((c) => c.trim())), _k: newKey() }])
    }
  }

  let body: React.ReactNode = null
  switch (block.type) {
    case 'paragraph':
      body = (
        <AutoTextarea
          value={block.text}
          onChange={(e) => onChange({ text: e.target.value })}
          onPaste={(e) => void onParagraphPaste(e)}
          placeholder="Écrivez ici… (**gras**, *italique*, [lien](https://…) ; collez une capture ou une plage Excel)"
          aria-label="Paragraphe"
        />
      )
      break
    case 'heading':
      body = (
        <input
          value={block.text}
          onChange={(e) => onChange({ text: e.target.value })}
          placeholder="Intertitre"
          style={{ ...styles.input, ...styles.headingInput }}
          aria-label="Intertitre"
        />
      )
      break
    case 'list':
      body = (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <AutoTextarea
            value={block.items.join('\n')}
            onChange={(e) => onChange({ items: e.target.value.split('\n') })}
            placeholder={'Un élément par ligne'}
            aria-label="Éléments de la liste"
          />
          <label style={styles.check}>
            <input type="checkbox" checked={Boolean(block.ordered)} onChange={(e) => onChange({ ordered: e.target.checked })} />
            Liste numérotée
          </label>
        </div>
      )
      break
    case 'table':
      body = (
        <>
          <TableEditor block={block} onChange={(patch) => onChange(patch)} />
          {onConvertStock ? (
            <div style={{ ...styles.inlineTools, marginTop: 6 }}>
              <button type="button" style={styles.miniBtn} onClick={onConvertStock}>→ Tableau stock en direct</button>
              <span style={styles.hint}>Remplace ce tableau (et l’intertitre qui le précède) par un tableau aux chiffres SAGE à jour, avec lien vers le groupe dans Stock.</span>
            </div>
          ) : null}
        </>
      )
      break
    case 'stock':
      body = <StockEditor block={block} onChange={(patch) => onChange(patch)} />
      break
    case 'image':
      body = <ImageEditor block={block} onChange={(patch) => onChange(patch)} onUpload={onUpload} />
      break
    case 'callout':
      body = (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={styles.inlineTools}>
            <input
              value={block.title || ''}
              onChange={(e) => onChange({ title: e.target.value })}
              placeholder="Titre de l’encadré"
              style={{ ...styles.input, flex: '1 1 240px' }}
              aria-label="Titre de l’encadré"
            />
            <select value={block.tone || 'info'} onChange={(e) => onChange({ tone: e.target.value as 'info' | 'alerte' })} style={styles.select} aria-label="Couleur de l’encadré">
              <option value="info">Information (bleu)</option>
              <option value="alerte">Alerte (rouge)</option>
            </select>
          </div>
          <AutoTextarea value={block.text} onChange={(e) => onChange({ text: e.target.value })} placeholder="Texte de l’encadré" aria-label="Texte de l’encadré" />
        </div>
      )
      break
    case 'link': {
      const valid = !block.url || Boolean(safeUrl(block.url))
      body = (
        <div style={styles.inlineTools}>
          <input value={block.label} onChange={(e) => onChange({ label: e.target.value })} placeholder="Libellé du lien" style={{ ...styles.input, flex: '1 1 220px' }} aria-label="Libellé du lien" />
          <input
            value={block.url}
            onChange={(e) => onChange({ url: e.target.value })}
            placeholder="https://… ou /stock/penurie"
            style={{ ...styles.input, flex: '1 1 260px', ...(valid ? {} : { borderColor: 'var(--cg-danger)' }) }}
            aria-label="Adresse du lien"
          />
          {!valid ? <span style={{ ...styles.hint, color: 'var(--cg-danger)' }}>Adresse non reconnue (https://… ou /chemin de l’app)</span> : null}
        </div>
      )
      break
    }
  }

  return (
    <div style={styles.blockCard}>
      <div style={styles.blockHead}>
        <span style={styles.blockType}>{BLOCK_LABELS[block.type]}</span>
        <span style={{ display: 'flex', gap: 4 }}>
          <button type="button" style={styles.iconBtn} disabled={index === 0} onClick={() => onMove(-1)} aria-label="Monter le bloc">↑</button>
          <button type="button" style={styles.iconBtn} disabled={index === count - 1} onClick={() => onMove(1)} aria-label="Descendre le bloc">↓</button>
          <button type="button" style={{ ...styles.iconBtn, color: 'var(--cg-danger)' }} onClick={onRemove} aria-label="Supprimer le bloc">✕</button>
        </span>
      </div>
      {body}
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────
function Editeur() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { rights, email } = useAccess()
  const { peutPublier, loading: droitsLoading } = usePeutPublier()
  const editId = searchParams.get('id')

  const [loaded, setLoaded] = useState(!editId)
  const [type, setType] = useState<ActualiteType>(searchParams.get('type') === 'nouveaute' ? 'nouveaute' : 'actualite')
  const [titre, setTitre] = useState('')
  const [categorie, setCategorie] = useState('')
  const [resume, setResume] = useState('')
  const [blocks, setBlocks] = useState<EditorBlock[]>([{ type: 'paragraph', text: '', _k: newKey() }])
  const [statut, setStatut] = useState<ActualiteStatut>('brouillon')
  const [dateDiffusion, setDateDiffusion] = useState(toLocalInput(null))
  const [afficherBandeau, setAfficherBandeau] = useState(true)
  const [bandeauJusquau, setBandeauJusquau] = useState(todayPlus(7))
  const [epingle, setEpingle] = useState(false)
  const [plateformes, setPlateformes] = useState<Plateforme[]>([...PLATEFORMES_DEFAUT])
  const [cibleAgences, setCibleAgences] = useState<string[]>([])
  const [agences, setAgences] = useState<string[]>([])
  const [preview, setPreview] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ tone: 'error' | 'info'; text: string } | null>(null)
  const [dragOver, setDragOver] = useState(false)

  // Chargement d'une publication existante
  useEffect(() => {
    if (!editId) return
    let cancelled = false
    void (async () => {
      try {
        const row = await fetchActualite(editId)
        if (cancelled) return
        if (!row) {
          setMessage({ tone: 'error', text: 'Publication introuvable.' })
        } else {
          setType(row.type)
          setTitre(row.titre)
          setCategorie(row.categorie || '')
          setResume(row.resume || '')
          setBlocks(row.contenu.length ? row.contenu.map((b) => ({ ...b, _k: newKey() }) as EditorBlock) : [emptyBlock('paragraph')])
          setStatut(row.statut)
          setDateDiffusion(toLocalInput(row.date_diffusion))
          setAfficherBandeau(row.afficher_bandeau)
          setBandeauJusquau(row.bandeau_jusquau || '')
          setEpingle(row.epingle)
          setPlateformes(row.plateformes)
          setCibleAgences(row.cible_agences)
        }
      } catch (err) {
        if (!cancelled) setMessage({ tone: 'error', text: `Chargement impossible : ${(err as Error).message}` })
      } finally {
        if (!cancelled) setLoaded(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [editId])

  // Liste des agences (ciblage)
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const { data } = await supabase.from('ref_collaborateurs').select('agence').not('agence', 'is', null).limit(2000)
      if (cancelled) return
      const list = [...new Set(((data || []) as { agence: string | null }[]).map((r) => String(r.agence || '').trim()).filter(Boolean))].sort()
      setAgences(list)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const upload = useCallback(async (file: File) => {
    if (file.size > 10 * 1024 * 1024) {
      setMessage({ tone: 'error', text: 'Image trop lourde (10 Mo maximum).' })
      return null
    }
    try {
      setMessage({ tone: 'info', text: 'Envoi de l’image…' })
      const path = await uploadActualiteImage(file, file.name)
      setMessage(null)
      return path
    } catch (err) {
      setMessage({ tone: 'error', text: `Envoi de l’image impossible : ${(err as Error).message}` })
      return null
    }
  }, [])

  const updateBlock = (key: string, patch: Partial<Block>) =>
    setBlocks((current) => current.map((b) => (b._k === key ? ({ ...b, ...patch } as EditorBlock) : b)))

  const moveBlock = (index: number, delta: number) =>
    setBlocks((current) => {
      const next = [...current]
      const target = index + delta
      if (target < 0 || target >= next.length) return current
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })

  const insertAfter = (index: number, added: EditorBlock[]) =>
    setBlocks((current) => [...current.slice(0, index + 1), ...added, ...current.slice(index + 1)])

  const addBlock = (blockType: BlockType) => setBlocks((current) => [...current, emptyBlock(blockType)])

  // Tableau → tableau stock en direct ; l'intertitre juste au-dessus devient son titre.
  const convertirEnStock = (key: string) =>
    setBlocks((current) => {
      const index = current.findIndex((b) => b._k === key)
      const table = current[index]
      if (index < 0 || !table || table.type !== 'table') return current
      const precedent = index > 0 ? current[index - 1] : null
      const titre = precedent && precedent.type === 'heading' ? precedent.text.trim() : ''
      const stock = tableVersStock(table, titre)
      if (!stock) return current
      const debut = titre ? index - 1 : index
      return [...current.slice(0, debut), { ...stock, _k: newKey() }, ...current.slice(index + 1)]
    })

  const onDrop = async (event: React.DragEvent) => {
    event.preventDefault()
    setDragOver(false)
    const files = Array.from(event.dataTransfer.files || []).filter((f) => f.type.startsWith('image/'))
    for (const file of files) {
      const path = await upload(file)
      if (path) setBlocks((current) => [...current, { type: 'image', path, caption: '', _k: newKey() }])
    }
  }

  const contenu = useMemo(() => stripKeys(blocks), [blocks])

  const contenuExistant =
    Boolean(titre.trim()) ||
    blocks.some((b) => (b.type === 'paragraph' || b.type === 'heading' ? b.text.trim() !== '' : true))

  const appliquerProposition = (p: PropositionIA) => {
    if (p.titre) setTitre(p.titre)
    if (p.categorie) setCategorie(p.categorie)
    setResume(p.resume)
    setBlocks(p.blocks.length ? p.blocks.map((b) => ({ ...b, _k: newKey() }) as EditorBlock) : [emptyBlock('paragraph')])
    if (type === 'actualite') {
      setAfficherBandeau(true)
      setBandeauJusquau(todayPlus(p.bandeauJours))
    }
    setPreview(true)
    setMessage({
      tone: 'info',
      text: p.pointsAVerifier.length
        ? `Proposition insérée (aperçu). ${p.pointsAVerifier.length} point(s) à vérifier signalés dans l’assistant. Cliquez « Revenir à l’édition » pour corriger.`
        : 'Proposition insérée (aperçu). Relisez les chiffres, puis « Revenir à l’édition » pour corriger ou publiez.',
    })
  }

  const save = async (nextStatut: ActualiteStatut) => {
    if (!titre.trim()) {
      setMessage({ tone: 'error', text: 'Le titre est obligatoire.' })
      return
    }
    const badLink = contenu.find((b) => b.type === 'link' && b.url && !safeUrl(b.url))
    if (badLink) {
      setMessage({ tone: 'error', text: 'Un lien a une adresse non reconnue (https://… ou /chemin de l’app).' })
      return
    }
    const diffusion = dateDiffusion ? new Date(dateDiffusion) : new Date()
    const payload = {
      type,
      titre: titre.trim(),
      categorie: categorie.trim() || null,
      resume: resume.trim() || null,
      contenu,
      statut: nextStatut,
      date_diffusion: Number.isNaN(diffusion.getTime()) ? new Date().toISOString() : diffusion.toISOString(),
      afficher_bandeau: type === 'actualite' ? afficherBandeau : false,
      bandeau_jusquau: type === 'actualite' && afficherBandeau && bandeauJusquau ? bandeauJusquau : null,
      epingle,
      cible_agences: cibleAgences,
      plateformes,
    }

    setSaving(true)
    setMessage(null)
    const enregistrer = (donnees: Record<string, unknown>) =>
      editId
        ? supabase.from('actualites').update(donnees).eq('id', editId).select('id').single()
        : supabase
            .from('actualites')
            .insert({ ...donnees, auteur_nom: String(rights.display_name || '').trim() || email || null })
            .select('id')
            .single()
    let result = await enregistrer(payload)
    // Script 20261014_actualites_plateformes.sql pas encore exécuté : la
    // colonne n'existe pas, on enregistre sans (affichage PC et mobile).
    let sansPlateformes = false
    if (result.error && /plateformes/i.test(result.error.message)) {
      const { plateformes: _ignore, ...sansColonne } = payload
      void _ignore
      result = await enregistrer(sansColonne)
      sansPlateformes = !result.error
    }
    setSaving(false)
    if (sansPlateformes) {
      window.alert('Enregistré, mais le choix PC / Mobile n’est pas encore actif : exécuter le script 20261014_actualites_plateformes.sql dans Supabase. La publication s’affiche pour l’instant sur PC et mobile.')
    }

    if (result.error) {
      setMessage({ tone: 'error', text: `Enregistrement impossible : ${result.error.message}` })
      return
    }
    setStatut(nextStatut)
    notifyActualitesChanged()
    const id = (result.data as { id: string }).id
    if (nextStatut === 'publie') {
      router.push(`${ACTUALITES_PATH}?id=${id}&type=${type}`)
    } else {
      setMessage({ tone: 'info', text: 'Brouillon enregistré.' })
      if (!editId) router.replace(`/actualites/editer?id=${id}`)
    }
  }

  if (droitsLoading) return <div style={styles.denied}>Chargement…</div>

  if (!peutPublier) {
    return (
      <div style={styles.denied}>
        <h1 style={styles.h1}>Publier une actualité</h1>
        <p style={styles.muted}>Cet écran est réservé aux rédacteurs du fil d’actualité. Rapprochez-vous d’un administrateur si vous devez publier.</p>
        <button type="button" style={styles.secondaryBtn} onClick={() => router.push(ACTUALITES_PATH)}>‹ Retour au fil d’actualité</button>
      </div>
    )
  }

  if (!loaded) return <div style={styles.denied}>Chargement…</div>

  const isPublished = statut === 'publie'
  const scheduled = dateDiffusion && new Date(dateDiffusion).getTime() > Date.now() + 60_000

  return (
    <div style={styles.page}>
      <div style={styles.topbar}>
        <button type="button" style={styles.backBtn} onClick={() => router.push(editId ? `${ACTUALITES_PATH}?id=${editId}` : ACTUALITES_PATH)}>
          ‹ Fil d’actualité
        </button>
        <h1 style={styles.h1}>
          {editId ? 'Modifier' : type === 'nouveaute' ? 'Nouvelle nouveauté du compagnon' : 'Nouvelle actualité'}
        </h1>
        <span style={styles.statusPill}>{statut === 'publie' ? 'Publiée' : statut === 'archive' ? 'Archivée' : 'Brouillon'}</span>
        <span style={{ flex: 1 }} />
        <button type="button" style={styles.secondaryBtn} onClick={() => setPreview((v) => !v)}>
          {preview ? 'Revenir à l’édition' : 'Aperçu'}
        </button>
        {!isPublished ? (
          <button type="button" style={styles.secondaryBtn} disabled={saving} onClick={() => void save('brouillon')}>
            Enregistrer le brouillon
          </button>
        ) : null}
        <button type="button" style={styles.primaryBtn} disabled={saving} onClick={() => void save('publie')}>
          {saving ? 'Enregistrement…' : isPublished ? 'Mettre à jour' : scheduled ? 'Programmer' : 'Publier'}
        </button>
      </div>

      {message ? (
        <div style={message.tone === 'error' ? styles.errorBox : styles.infoBox} role={message.tone === 'error' ? 'alert' : 'status'}>
          {message.text}
        </div>
      ) : null}

      <AssistantRedaction type={type} contenuExistant={contenuExistant} onApply={appliquerProposition} />

      <div style={styles.columns}>
        <section
          style={{ ...styles.editor, ...(dragOver ? styles.editorDrag : {}) }}
          onDragOver={(e) => {
            if (Array.from(e.dataTransfer.items || []).some((i) => i.kind === 'file')) {
              e.preventDefault()
              setDragOver(true)
            }
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => void onDrop(e)}
        >
          <input
            value={titre}
            onChange={(e) => setTitre(e.target.value)}
            placeholder={type === 'nouveaute' ? 'Titre de la nouveauté' : 'Titre de l’actualité'}
            style={styles.titleInput}
            aria-label="Titre"
          />
          <AutoTextarea
            value={resume}
            onChange={(e) => setResume(e.target.value)}
            placeholder="Résumé en une phrase (facultatif — sinon le début du texte est utilisé dans la liste)"
            aria-label="Résumé"
            style={{ fontSize: 14 }}
          />

          {preview ? (
            <div style={styles.previewBox}>
              <ActualiteContent blocks={contenu} />
            </div>
          ) : (
            <>
              <div style={styles.blocks}>
                {blocks.map((block, index) => (
                  <BlockEditor
                    key={block._k}
                    block={block}
                    index={index}
                    count={blocks.length}
                    onChange={(patch) => updateBlock(block._k, patch)}
                    onMove={(delta) => moveBlock(index, delta)}
                    onRemove={() => setBlocks((current) => current.filter((b) => b._k !== block._k))}
                    onInsertAfter={(added) => insertAfter(index, added)}
                    onUpload={upload}
                    onConvertStock={block.type === 'table' && tableVersStock(block, '') ? () => convertirEnStock(block._k) : undefined}
                  />
                ))}
              </div>
              <div style={styles.addBar}>
                <span style={styles.hint}>Ajouter :</span>
                {(Object.keys(BLOCK_LABELS) as BlockType[]).map((blockType) => (
                  <button key={blockType} type="button" style={styles.addBtn} onClick={() => addBlock(blockType)}>
                    + {BLOCK_LABELS[blockType]}
                  </button>
                ))}
              </div>
              <p style={styles.hint}>
                Déposez une image n’importe où sur l’éditeur pour l’ajouter à la fin. Dans un paragraphe, Ctrl + V d’une capture ou d’une plage Excel crée le bloc image ou tableau correspondant.
              </p>
            </>
          )}
        </section>

        <aside style={styles.side}>
          <div style={styles.panel}>
            <h2 style={styles.panelTitle}>Type</h2>
            <label style={styles.radio}>
              <input type="radio" name="type" checked={type === 'actualite'} onChange={() => setType('actualite')} />
              Actualité (fil + bandeau défilant)
            </label>
            <label style={styles.radio}>
              <input type="radio" name="type" checked={type === 'nouveaute'} onChange={() => setType('nouveaute')} />
              Nouveauté du compagnon (fenêtre « Nouveau »)
            </label>
          </div>

          <div style={styles.panel}>
            <h2 style={styles.panelTitle}>Afficher sur</h2>
            {(['pc', 'mobile'] as Plateforme[]).map((p) => (
              <label key={p} style={styles.check}>
                <input
                  type="checkbox"
                  checked={plateformes.includes(p)}
                  onChange={(e) =>
                    setPlateformes((current) => {
                      const next = e.target.checked ? [...new Set([...current, p])] : current.filter((x) => x !== p)
                      return next.length > 0 ? next : current
                    })
                  }
                />
                {p === 'pc' ? 'PC (bandeau, accueil, fil d’actualité)' : 'Mobile (Compagnon : « À la une », fil d’actu)'}
              </label>
            ))}
            <span style={styles.hint}>Au moins une case. Une nouveauté qui ne concerne que le PC (ou le téléphone) n’encombre pas l’autre.</span>
          </div>

          <div style={styles.panel}>
            <h2 style={styles.panelTitle}>Diffusion</h2>
            <label style={styles.field}>
              Catégorie
              <input list="cgc-actu-categories" value={categorie} onChange={(e) => setCategorie(e.target.value)} placeholder="Pénurie, Opération, Outil…" style={styles.input} />
              <datalist id="cgc-actu-categories">
                {ACTUALITE_CATEGORIES.map((c) => <option key={c} value={c} />)}
              </datalist>
            </label>
            <label style={styles.field}>
              Date de diffusion
              <input type="datetime-local" value={dateDiffusion} onChange={(e) => setDateDiffusion(e.target.value)} style={styles.input} />
              <span style={styles.hint}>{scheduled ? 'Publication programmée : invisible avant cette date.' : 'Visible dès la publication.'}</span>
            </label>
            {type === 'actualite' ? (
              <>
                <label style={styles.check}>
                  <input type="checkbox" checked={afficherBandeau} onChange={(e) => setAfficherBandeau(e.target.checked)} />
                  Afficher dans le bandeau défilant
                </label>
                {afficherBandeau ? (
                  <label style={styles.field}>
                    Retirer du bandeau après le
                    <input type="date" value={bandeauJusquau} onChange={(e) => setBandeauJusquau(e.target.value)} style={styles.input} />
                    <span style={styles.hint}>Vide = reste dans le bandeau jusqu’à ce que chacun la masque.</span>
                  </label>
                ) : null}
              </>
            ) : null}
            <label style={styles.check}>
              <input type="checkbox" checked={epingle} onChange={(e) => setEpingle(e.target.checked)} />
              Épingler en tête du fil
            </label>
          </div>

          <div style={styles.panel}>
            <h2 style={styles.panelTitle}>Destinataires</h2>
            <label style={styles.radio}>
              <input type="radio" name="cible" checked={cibleAgences.length === 0} onChange={() => setCibleAgences([])} />
              Tous les utilisateurs
            </label>
            <label style={styles.radio}>
              <input type="radio" name="cible" checked={cibleAgences.length > 0} onChange={() => setCibleAgences(agences.slice(0, 1))} disabled={agences.length === 0} />
              Agences choisies
            </label>
            {cibleAgences.length > 0 ? (
              <div style={styles.agences}>
                {agences.map((agence) => (
                  <label key={agence} style={styles.check}>
                    <input
                      type="checkbox"
                      checked={cibleAgences.includes(agence)}
                      onChange={(e) =>
                        setCibleAgences((current) =>
                          e.target.checked ? [...current, agence] : current.filter((a) => a !== agence).length ? current.filter((a) => a !== agence) : current
                        )
                      }
                    />
                    {agence}
                  </label>
                ))}
              </div>
            ) : null}
            <span style={styles.hint}>Les utilisateurs sans restriction d’agence voient toutes les publications.</span>
          </div>
        </aside>
      </div>
    </div>
  )
}

export default function EditerActualitePage() {
  return (
    <Suspense fallback={<div style={{ padding: 24, color: 'rgba(var(--cg-ink-rgb), 0.6)' }}>Chargement…</div>}>
      <Editeur />
    </Suspense>
  )
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    maxWidth: 1360,
    margin: '0 auto',
    padding: '6px 4px 48px',
    color: 'var(--cg-ink)',
    fontFamily: 'var(--font-body)',
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  denied: {
    maxWidth: 720,
    margin: '40px auto',
    padding: 24,
    color: 'var(--cg-ink)',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    alignItems: 'flex-start',
  },
  topbar: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    flexWrap: 'wrap',
  },
  backBtn: {
    border: 'none',
    background: 'transparent',
    color: 'var(--cg-accent)',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    padding: '8px 0',
  },
  h1: {
    margin: 0,
    fontFamily: 'var(--font-display)',
    fontSize: 24,
    fontWeight: 700,
  },
  statusPill: {
    fontFamily: 'var(--font-mono)',
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    color: 'var(--cg-warn-ink)',
    border: '1px solid rgba(var(--cg-ink-rgb), 0.16)',
    borderRadius: 999,
    padding: '4px 10px',
  },
  primaryBtn: {
    padding: '10px 16px',
    borderRadius: 9,
    border: 'none',
    background: 'var(--cg-accent)',
    color: 'var(--cg-bg)',
    fontWeight: 700,
    fontSize: 14,
    cursor: 'pointer',
  },
  secondaryBtn: {
    padding: '9px 14px',
    borderRadius: 9,
    border: '1px solid rgba(var(--cg-ink-rgb), 0.2)',
    background: 'transparent',
    color: 'var(--cg-ink)',
    fontWeight: 500,
    fontSize: 14,
    cursor: 'pointer',
  },
  errorBox: {
    padding: '11px 14px',
    borderRadius: 10,
    border: '1px solid var(--cg-danger-border)',
    background: 'var(--cg-danger-bg)',
    color: 'var(--cg-danger-text)',
    fontSize: 14,
  },
  infoBox: {
    padding: '11px 14px',
    borderRadius: 10,
    border: '1px solid var(--cg-accent-border)',
    background: 'var(--cg-accent-bg)',
    color: 'var(--cg-ink)',
    fontSize: 14,
  },
  columns: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    gap: 20,
  },
  editor: {
    flex: '999 1 600px',
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    padding: 'clamp(16px, 3vw, 28px)',
    borderRadius: 16,
    border: '1px solid rgba(var(--cg-ink-rgb), 0.10)',
    background: 'var(--cg-surface)',
  },
  editorDrag: {
    outline: '2px dashed var(--cg-accent)',
    outlineOffset: -6,
  },
  titleInput: {
    width: '100%',
    boxSizing: 'border-box',
    padding: '6px 0 10px',
    border: 'none',
    borderBottom: '1px solid rgba(var(--cg-ink-rgb), 0.12)',
    background: 'transparent',
    color: 'var(--cg-ink)',
    fontFamily: 'var(--font-display)',
    fontSize: 28,
    fontWeight: 700,
    outline: 'none',
  },
  textarea: {
    width: '100%',
    boxSizing: 'border-box',
    padding: '10px 12px',
    borderRadius: 9,
    border: '1px solid rgba(var(--cg-ink-rgb), 0.16)',
    background: 'rgba(var(--cg-ink-rgb), 0.02)',
    color: 'var(--cg-ink)',
    fontFamily: 'inherit',
    fontSize: 15,
    lineHeight: 1.55,
    resize: 'vertical',
    overflow: 'hidden',
  },
  input: {
    width: '100%',
    boxSizing: 'border-box',
    padding: '9px 11px',
    borderRadius: 8,
    border: '1px solid rgba(var(--cg-ink-rgb), 0.18)',
    background: 'var(--cg-surface)',
    color: 'var(--cg-ink)',
    fontFamily: 'inherit',
    fontSize: 14,
  },
  headingInput: {
    fontFamily: 'var(--font-display)',
    fontSize: 19,
    fontWeight: 700,
  },
  select: {
    padding: '9px 11px',
    borderRadius: 8,
    border: '1px solid rgba(var(--cg-ink-rgb), 0.18)',
    background: 'var(--cg-surface)',
    color: 'var(--cg-ink)',
    fontFamily: 'inherit',
    fontSize: 14,
  },
  blocks: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  blockCard: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    padding: '10px 12px 12px',
    borderRadius: 12,
    border: '1px solid rgba(var(--cg-ink-rgb), 0.10)',
    background: 'rgba(var(--cg-ink-rgb), 0.025)',
  },
  blockHead: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  blockType: {
    fontFamily: 'var(--font-mono)',
    fontSize: 10.5,
    fontWeight: 600,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    color: 'rgba(var(--cg-ink-rgb), 0.55)',
  },
  iconBtn: {
    width: 30,
    height: 30,
    borderRadius: 7,
    border: '1px solid rgba(var(--cg-ink-rgb), 0.14)',
    background: 'transparent',
    color: 'var(--cg-ink)',
    cursor: 'pointer',
    fontSize: 13,
  },
  inlineTools: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  miniBtn: {
    padding: '6px 10px',
    borderRadius: 7,
    border: '1px solid rgba(var(--cg-ink-rgb), 0.16)',
    background: 'transparent',
    color: 'var(--cg-ink)',
    fontSize: 12.5,
    cursor: 'pointer',
  },
  check: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 13.5,
    cursor: 'pointer',
  },
  radio: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 14,
    cursor: 'pointer',
  },
  hint: {
    margin: 0,
    fontSize: 12.5,
    lineHeight: 1.45,
    color: 'rgba(var(--cg-ink-rgb), 0.58)',
  },
  tableGridWrap: {
    overflowX: 'auto',
  },
  tableGrid: {
    borderCollapse: 'collapse',
    minWidth: '100%',
  },
  tableGridCell: {
    padding: 2,
    minWidth: 120,
  },
  cellInput: {
    width: '100%',
    boxSizing: 'border-box',
    padding: '7px 8px',
    borderRadius: 6,
    border: '1px solid rgba(var(--cg-ink-rgb), 0.14)',
    background: 'var(--cg-surface)',
    color: 'var(--cg-ink)',
    fontFamily: 'inherit',
    fontSize: 13.5,
  },
  cellHead: {
    fontWeight: 700,
    background: 'rgba(var(--cg-ink-rgb), 0.05)',
  },
  imagePreview: {
    maxWidth: '100%',
    maxHeight: 360,
    alignSelf: 'flex-start',
    borderRadius: 8,
    border: '1px solid rgba(var(--cg-ink-rgb), 0.12)',
  },
  dropZone: {
    padding: 24,
    borderRadius: 10,
    border: '1px dashed rgba(var(--cg-ink-rgb), 0.28)',
    textAlign: 'center',
    fontSize: 14,
    color: 'rgba(var(--cg-ink-rgb), 0.62)',
    outline: 'none',
  },
  addBar: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    paddingTop: 4,
  },
  addBtn: {
    padding: '7px 11px',
    borderRadius: 8,
    border: '1px dashed rgba(var(--cg-ink-rgb), 0.26)',
    background: 'transparent',
    color: 'var(--cg-ink)',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
  previewBox: {
    paddingTop: 8,
  },
  side: {
    flex: '1 1 300px',
    maxWidth: 400,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
  },
  panel: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    padding: 16,
    borderRadius: 14,
    border: '1px solid rgba(var(--cg-ink-rgb), 0.10)',
    background: 'var(--cg-surface)',
  },
  panelTitle: {
    margin: 0,
    fontFamily: 'var(--font-display)',
    fontSize: 16,
    fontWeight: 700,
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: 5,
    fontSize: 13,
    fontWeight: 500,
    color: 'rgba(var(--cg-ink-rgb), 0.75)',
  },
  agences: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: 6,
    maxHeight: 220,
    overflowY: 'auto',
    padding: '4px 2px',
  },
  muted: {
    fontSize: 14,
    color: 'rgba(var(--cg-ink-rgb), 0.65)',
    lineHeight: 1.5,
  },
}
