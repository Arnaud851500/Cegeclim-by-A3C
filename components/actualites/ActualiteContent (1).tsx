'use client'

// ============================================================================
// components/actualites/ActualiteContent.tsx — Rendu d'une publication
// ----------------------------------------------------------------------------
// Rend la liste de blocs (lib/actualites.ts) dans une mise en page de lecture :
// texte en colonne de lecture, intertitres, listes, tableaux défilant
// horizontalement, impressions d'écran agrandissables, encadrés, liens.
// Texte enrichi minimal dans les paragraphes : **gras**, *italique*,
// [libellé](https://…) ou [libellé](/chemin/interne), adresses http(s) nues.
// Aucun HTML n'est interprété : tout est rendu comme texte.
//
// ÉVOLUTION (2026-10-15) : bloc « Tableau stock en direct » (StockTable) —
// chiffres SAGE lus à l'affichage (get_stock_actualite), titre cliquable vers
// l'écran Stock avec le groupe d'articles sélectionné, référence cliquable
// vers sa fiche. Dans le Compagnon mobile, l'ouverture passe par la pile de
// MobileShell (ouvrirStock).
// ÉVOLUTION (2026-10-15 bis, demandé par Arnaud) : les tableaux (saisis ou
// stock en direct) peuvent occuper toute la largeur de l'article tandis que
// le texte garde une colonne de lecture (prop largeurTexte) — encadrés
// compris dans les blocs larges ; tableau stock
// resserré (désignation sans le code article répété, « arrivage » sous la
// dispo, en-têtes courts) pour tenir sans défilement horizontal.
// ============================================================================

import { Fragment, useEffect, useMemo, useState } from 'react'
import type React from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import {
  STOCK_COLONNES_DEFAUT,
  fetchStockDirect,
  isInternalUrl,
  ouvrirStock,
  safeUrl,
  stockBlockGroupe,
  stockBlockRefs,
  stockGroupeUrl,
  useSignedImages,
  type Block,
  type StockBlock,
  type StockLigneDirect,
} from '@/lib/actualites'

// ── Texte enrichi ────────────────────────────────────────────────────────────
const INLINE_RE = /(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*)|(\[[^\]]+\]\([^)\s]+\))|(https?:\/\/[^\s)]+)/g

function InlineLink({ href, children }: { href: string; children: React.ReactNode }) {
  const router = useRouter()
  if (isInternalUrl(href)) {
    return (
      <a
        href={href}
        onClick={(event) => {
          if (event.metaKey || event.ctrlKey) return
          event.preventDefault()
          router.push(href)
        }}
        style={styles.link}
      >
        {children}
      </a>
    )
  }
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" style={styles.link}>
      {children}
      <span aria-hidden="true"> ↗</span>
    </a>
  )
}

export function RichText({ text }: { text: string }) {
  const parts: React.ReactNode[] = []
  let last = 0
  let match: RegExpExecArray | null
  const re = new RegExp(INLINE_RE.source, 'g')
  let key = 0
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index))
    const token = match[0]
    if (match[1]) {
      parts.push(<strong key={key++}>{token.slice(2, -2)}</strong>)
    } else if (match[2]) {
      parts.push(<em key={key++}>{token.slice(1, -1)}</em>)
    } else if (match[3]) {
      const m = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token)
      const href = safeUrl(m?.[2])
      parts.push(href ? <InlineLink key={key++} href={href}>{m?.[1]}</InlineLink> : (m?.[1] ?? token))
    } else if (match[4]) {
      const href = safeUrl(token)
      parts.push(href ? <InlineLink key={key++} href={href}>{token}</InlineLink> : token)
    }
    last = match.index + token.length
  }
  if (last < text.length) parts.push(text.slice(last))
  return <>{parts}</>
}

// ── Cellules de tableau : nombres alignés à droite ───────────────────────────
function isNumericCell(value: string) {
  return /^[-+]?[\d\s  ]+([.,]\d+)?\s*(%|€|k€|K€|M€|u|p\.?)?$/.test(value.trim()) && /\d/.test(value)
}

// ── Visionneuse d'image ──────────────────────────────────────────────────────
function Lightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={alt || 'Image'} onClick={onClose} style={styles.lightbox}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} style={styles.lightboxImg} />
      <button type="button" onClick={onClose} style={styles.lightboxClose} aria-label="Fermer">✕</button>
    </div>,
    document.body
  )
}

function ImageBlock({ src, caption }: { src?: string; caption?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <figure style={styles.figure}>
      {src ? (
        <button type="button" onClick={() => setOpen(true)} style={styles.figureButton} title="Agrandir l’image">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={caption || 'Impression d’écran'} style={styles.figureImg} loading="lazy" />
        </button>
      ) : (
        <div style={styles.figurePlaceholder}>Chargement de l’image…</div>
      )}
      {caption ? <figcaption style={styles.figcaption}>{caption}</figcaption> : null}
      {open && src ? <Lightbox src={src} alt={caption || ''} onClose={() => setOpen(false)} /> : null}
    </figure>
  )
}

// ── Tableau stock en direct ──────────────────────────────────────────────────
function fmtQte(n: number) {
  return Math.round(n).toLocaleString('fr-FR').replace('-', '−')
}

function fmtJourMois(iso: string | null) {
  if (!iso) return ''
  const [, m, d] = iso.split('-')
  return `${d}/${m}`
}

function fmtMaj(iso: string | null) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' })
}

function libelleArrivages(arrivages: StockLigneDirect['arrivages']) {
  if (arrivages.length === 0) return '—'
  const parts = arrivages.slice(0, 3).map((a) => {
    const quand = a.statut === 'SANS_DATE' || !a.date ? 'sans date' : a.statut === 'RETARD' ? `en retard (${fmtJourMois(a.date)})` : fmtJourMois(a.date)
    return `${fmtQte(a.q)} · ${quand}`
  })
  if (arrivages.length > 3) parts.push(`+ ${arrivages.length - 3} autre(s)`)
  return parts.join('\n')
}

/** Désignation SAGE sans le code article répété en fin de libellé (« … 230/1 RAS2HVRC3 »). */
function designationCourte(designation: string | null, ref: string) {
  if (!designation) return ''
  const code = ref.replace(/[^A-Z0-9.]/gi, '').toUpperCase()
  const mots = designation.trim().split(/\s+/)
  const dernier = (mots[mots.length - 1] || '').replace(/[^A-Z0-9.]/gi, '').toUpperCase()
  if (mots.length > 1 && dernier && (dernier === code || code.startsWith(dernier) || dernier.startsWith(code.slice(0, Math.max(4, code.length - 2))))) {
    return mots.slice(0, -1).join(' ')
  }
  return designation
}

function StockTable({ block }: { block: StockBlock }) {
  const router = useRouter()
  const refs = useMemo(() => stockBlockRefs(block), [block])
  const refsKey = refs.join('|')
  const [rows, setRows] = useState<Record<string, StockLigneDirect> | null>(null)
  const [indisponible, setIndisponible] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    if (refs.length === 0) return
    fetchStockDirect(refs)
      .then((data) => {
        if (cancelled) return
        if (data === null) {
          setIndisponible(true)
          setRows({})
          return
        }
        const map: Record<string, StockLigneDirect> = {}
        for (const row of data) map[row.reference_article] = row
        setRows(map)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setErreur(e instanceof Error ? e.message : String(e))
        setRows({})
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refsKey])

  if (refs.length === 0) return null

  const groupe = stockBlockGroupe(block)
  const colonnes = block.colonnes && block.colonnes.length > 0 ? block.colonnes : STOCK_COLONNES_DEFAUT
  const avecNotes = (block.lignes || []).some((l) => String(l.note || '').trim())
  const notes = new Map<string, string>()
  for (const ligne of block.lignes || []) {
    const ref = String(ligne.ref || '').trim().toUpperCase()
    if (ref && ligne.note && !notes.has(ref)) notes.set(ref, ligne.note)
  }
  const maj = rows
    ? Object.values(rows).reduce<string | null>((acc, r) => (r.maj && (!acc || r.maj > acc) ? r.maj : acc), null)
    : null
  const enDirect = rows !== null && !indisponible && !erreur

  // 15/10/2026 (demandé par Arnaud) : sur PC, l'écran Stock s'ouvre dans un
  // nouvel onglet (liens target="_blank", la publication reste affichée).
  // Dans le Compagnon mobile, il reste empilé dans l'appli (ouvrirStock).
  const dansCompagnon = () => typeof window !== 'undefined' && Boolean(window.__cgcMobileShellStock)
  const ouvrirGroupe = (event: React.MouseEvent) => {
    if (!dansCompagnon()) return
    event.preventDefault()
    ouvrirStock({ groupe, refs }, (href) => router.push(href))
  }
  const ouvrirRef = (event: React.MouseEvent, ref: string) => {
    if (!dansCompagnon()) return
    event.preventDefault()
    ouvrirStock({ ref }, (href) => router.push(href))
  }

  const entetes = ['Référence', 'Dispo', 'Désignation']
  if (colonnes.includes('stock')) entetes.push('Stock')
  if (colonnes.includes('reserve')) entetes.push('Réservé')
  if (colonnes.includes('commande')) entetes.push('Commandé')
  if (colonnes.includes('arrivages')) entetes.push('Arrivages')
  if (avecNotes) entetes.push('Remarque')
  const numeriques = new Set(['Dispo', 'Stock', 'Réservé', 'Commandé'])
  const titres: Record<string, string> = {
    Dispo: 'Stock − réservé (CDC + PL) ; négatif = déjà engagé',
    Réservé: 'CDC + préparations de livraison (PL)',
    Commandé: 'Commandes fournisseurs en cours (CDF)',
  }

  return (
    <section style={styles.stockSection}>
      <h3 style={{ ...styles.heading, marginBottom: '0.3em' }}>
        <a href={stockGroupeUrl(groupe, refs)} onClick={ouvrirGroupe} target="_blank" rel="noopener noreferrer" style={styles.stockTitleLink} title="Ouvrir ce groupe dans l’écran Stock (nouvel onglet)">
          {block.titre || groupe}
          <span aria-hidden="true" style={styles.stockTitleArrow}> ›</span>
        </a>
      </h3>
      <div style={styles.stockMeta}>
        {enDirect ? (
          <span style={styles.stockLive}>
            <span style={styles.stockLiveDot} aria-hidden="true" />
            Chiffres SAGE en direct{maj ? ` · synchro du ${fmtMaj(maj)}` : ''}
          </span>
        ) : rows === null ? (
          <span>Chargement des chiffres SAGE…</span>
        ) : (
          <span style={{ color: 'var(--cg-danger)' }}>
            {indisponible ? 'Chiffres en direct pas encore disponibles.' : `Chiffres indisponibles : ${erreur}`}
          </span>
        )}
        <a href={stockGroupeUrl(groupe, refs)} onClick={ouvrirGroupe} target="_blank" rel="noopener noreferrer" style={styles.link}>
          Voir le groupe dans Stock ↗
        </a>
      </div>
      <div style={styles.tableWrap}>
        <table style={{ ...styles.table, ...styles.stockTable }}>
          <thead>
            <tr>
              {entetes.map((h) => (
                <th key={h} title={titres[h]} style={{ ...styles.th, ...styles.stockTh, ...(numeriques.has(h) ? { textAlign: 'right' } : {}) }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {refs.map((ref) => {
              const r = rows?.[ref]
              const attente = rows === null
              const vide = attente ? '…' : '—'
              const dispoCouleur = r ? (r.dispo > 0 ? 'var(--cg-ok)' : 'var(--cg-danger)') : undefined
              return (
                <tr key={ref}>
                  <td style={{ ...styles.td, ...styles.stockTd, whiteSpace: 'nowrap' }}>
                    <a href={`/stock?ref=${encodeURIComponent(ref)}`} onClick={(e) => ouvrirRef(e, ref)} target="_blank" rel="noopener noreferrer" title="Ouvrir la fiche dans un nouvel onglet" style={styles.stockRefLink}>{ref}</a>
                  </td>
                  <td style={{ ...styles.td, ...styles.stockTd, ...styles.tdNum, fontWeight: 700, color: dispoCouleur }}>
                    {r ? fmtQte(r.dispo) : vide}
                    {r && r.dispo <= 0 && r.en_commande > 0 ? <span style={styles.stockArrow}>→ arrivage</span> : null}
                  </td>
                  <td style={{ ...styles.td, ...styles.stockTd, minWidth: 150 }}>{r ? designationCourte(r.designation, ref) || '—' : ''}</td>
                  {colonnes.includes('stock') ? <td style={{ ...styles.td, ...styles.stockTd, ...styles.tdNum }}>{r ? fmtQte(r.stock) : vide}</td> : null}
                  {colonnes.includes('reserve') ? <td style={{ ...styles.td, ...styles.stockTd, ...styles.tdNum }}>{r ? fmtQte(r.reserve) : vide}</td> : null}
                  {colonnes.includes('commande') ? <td style={{ ...styles.td, ...styles.stockTd, ...styles.tdNum }}>{r ? fmtQte(r.en_commande) : vide}</td> : null}
                  {colonnes.includes('arrivages') ? (
                    <td style={{ ...styles.td, ...styles.stockTd, whiteSpace: 'pre-line', minWidth: 120, fontSize: '0.92em' }}>{r ? libelleArrivages(r.arrivages) : vide}</td>
                  ) : null}
                  {avecNotes ? (
                    <td style={{ ...styles.td, ...styles.stockTd, minWidth: 140 }}>
                      <RichText text={notes.get(ref) || ''} />
                    </td>
                  ) : null}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

// ── Rendu ────────────────────────────────────────────────────────────────────
/** Blocs qui peuvent occuper toute la largeur de l'article (les autres restent dans la colonne de lecture). */
// 15/10/2026 (demandé par Arnaud) : les encadrés s'alignent sur la largeur des tableaux.
// 15/10/2026 bis : paragraphes (dont le chapô sous la photo), photos,
// intertitres, listes et liens aussi — toute la publication s'aligne sur la
// largeur des tableaux (largeurTexte ne s'applique plus à aucun bloc lu
// dans /actualites ; la prop reste disponible pour un autre usage).
const BLOCS_LARGES = new Set<Block['type']>(['table', 'stock', 'callout', 'paragraph', 'image', 'heading', 'list', 'link'])

export default function ActualiteContent({
  blocks,
  compact = false,
  style,
  largeurTexte,
}: {
  blocks: Block[]
  compact?: boolean
  /** Largeur max (px) du texte ; tableaux et tableaux stock prennent toute la largeur. Absent = tout à la même largeur. */
  largeurTexte?: number
  /** Ajustements de taille (ex. lecture sur téléphone). */
  style?: React.CSSProperties
}) {
  const imagePaths = useMemo(
    () => blocks.filter((b): b is Extract<Block, { type: 'image' }> => b.type === 'image' && Boolean(b.path)).map((b) => b.path),
    [blocks]
  )
  const urls = useSignedImages(imagePaths)

  return (
    <div style={{ ...styles.body, ...(compact ? styles.bodyCompact : {}), ...(style || {}) }}>
      {blocks.map((block, index) => {
        const rendu = renduBloc(block, index)
        if (!rendu || !largeurTexte || BLOCS_LARGES.has(block.type)) return rendu
        return (
          <div key={index} style={{ maxWidth: largeurTexte }}>
            {rendu}
          </div>
        )
      })}
    </div>
  )

  function renduBloc(block: Block, index: number): React.ReactNode {
        switch (block.type) {
          case 'paragraph':
            return block.text.trim() ? (
              <p key={index} style={styles.paragraph}>
                <RichText text={block.text} />
              </p>
            ) : null
          case 'heading':
            return block.text.trim() ? (
              <h3 key={index} style={styles.heading}>{block.text}</h3>
            ) : null
          case 'list': {
            const items = block.items.filter((item) => item.trim())
            if (items.length === 0) return null
            const ListTag = block.ordered ? 'ol' : 'ul'
            return (
              <ListTag key={index} style={styles.list}>
                {items.map((item, i) => (
                  <li key={i} style={styles.listItem}>
                    <RichText text={item} />
                  </li>
                ))}
              </ListTag>
            )
          }
          case 'table': {
            const rows = block.rows.filter((row) => row.some((cell) => String(cell || '').trim()))
            if (rows.length === 0) return null
            const head = block.header !== false ? rows[0] : null
            const body = block.header !== false ? rows.slice(1) : rows
            // Colonne alignée à droite seulement si toutes ses valeurs sont des
            // nombres (une colonne « 12 / −5 → arrivage » reste à gauche).
            const width = Math.max(...rows.map((row) => row.length))
            const numericCols = Array.from({ length: width }, (_, c) => {
              const values = body.map((row) => String(row[c] || '').trim()).filter(Boolean)
              return values.length > 0 && values.every(isNumericCell)
            })
            return (
              <div key={index} style={styles.tableWrap}>
                <table style={styles.table}>
                  {head ? (
                    <thead>
                      <tr>
                        {head.map((cell, c) => (
                          <th key={c} style={{ ...styles.th, ...(numericCols[c] ? { textAlign: 'right' } : {}) }}>{cell}</th>
                        ))}
                      </tr>
                    </thead>
                  ) : null}
                  <tbody>
                    {body.map((row, r) => (
                      <tr key={r}>
                        {row.map((cell, c) => (
                          <td
                            key={c}
                            style={{
                              ...styles.td,
                              // Cellules courtes (références, dates) sur une ligne ; textes
                              // longs sur une largeur lisible : le tableau défile sur le côté.
                              ...(String(cell || '').length <= 20 ? { whiteSpace: 'nowrap' } : { minWidth: 220 }),
                              ...(numericCols[c] ? styles.tdNum : {}),
                            }}
                          >
                            <RichText text={String(cell || '')} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          }
          case 'image':
            // Bloc image laissé vide dans l'éditeur : rien à afficher.
            if (!block.path) return null
            return <ImageBlock key={index} src={urls[block.path]} caption={block.caption} />
          case 'callout':
            return block.text.trim() || block.title?.trim() ? (
              <aside key={index} style={{ ...styles.callout, ...(block.tone === 'alerte' ? styles.calloutAlerte : {}) }}>
                {block.title ? (
                  <div style={{ ...styles.calloutTitle, ...(block.tone === 'alerte' ? styles.calloutTitleAlerte : {}) }}>
                    {block.title}
                  </div>
                ) : null}
                <div style={styles.calloutText}>
                  {block.text.split('\n').map((line, i) => (
                    <Fragment key={i}>
                      {i > 0 ? <br /> : null}
                      <RichText text={line} />
                    </Fragment>
                  ))}
                </div>
              </aside>
            ) : null
          case 'stock':
            return <StockTable key={index} block={block} />
          case 'link': {
            const href = safeUrl(block.url)
            if (!href || !block.label.trim()) return null
            return (
              <p key={index} style={styles.linkBlock}>
                <InlineLink href={href}>{block.label} {isInternalUrl(href) ? '›' : ''}</InlineLink>
              </p>
            )
          }
          default:
            return null
        }
  }
}

const styles: Record<string, React.CSSProperties> = {
  body: {
    fontFamily: 'var(--font-reading, var(--font-body))',
    fontSize: 18,
    lineHeight: 1.7,
    color: 'var(--cg-reading-ink)',
  },
  bodyCompact: {
    fontSize: 15.5,
    lineHeight: 1.6,
  },
  paragraph: {
    margin: '0 0 1em',
    whiteSpace: 'pre-line',
  },
  heading: {
    margin: '1.5em 0 0.55em',
    fontFamily: 'var(--font-display)',
    fontSize: '1.2em',
    fontWeight: 700,
    lineHeight: 1.25,
    color: 'var(--cg-ink)',
  },
  list: {
    margin: '0 0 1em',
    paddingLeft: '1.3em',
  },
  listItem: {
    margin: '0.25em 0',
  },
  link: {
    color: 'var(--cg-accent)',
    textDecoration: 'underline',
    textUnderlineOffset: 3,
  },
  linkBlock: {
    margin: '0 0 0.6em',
    fontFamily: 'var(--font-body)',
    fontWeight: 600,
    fontSize: '0.92em',
  },
  tableWrap: {
    margin: '0.4em 0 1.4em',
    overflowX: 'auto',
    border: '1px solid rgba(var(--cg-ink-rgb), 0.12)',
    borderRadius: 10,
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontFamily: 'var(--font-body)',
    fontSize: 14.5,
    lineHeight: 1.45,
  },
  th: {
    padding: '10px 12px',
    textAlign: 'left',
    fontFamily: 'var(--font-mono)',
    fontSize: 11.5,
    fontWeight: 600,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: 'rgba(var(--cg-ink-rgb), 0.62)',
    background: 'rgba(var(--cg-ink-rgb), 0.05)',
    borderBottom: '1px solid rgba(var(--cg-ink-rgb), 0.12)',
    whiteSpace: 'nowrap',
  },
  td: {
    padding: '9px 12px',
    borderBottom: '1px solid rgba(var(--cg-ink-rgb), 0.08)',
    verticalAlign: 'top',
    color: 'var(--cg-ink)',
  },
  tdNum: {
    textAlign: 'right',
    fontVariantNumeric: 'tabular-nums',
    whiteSpace: 'nowrap',
  },
  figure: {
    margin: '0.6em 0 1.4em',
  },
  figureButton: {
    display: 'block',
    width: '100%',
    padding: 0,
    border: '1px solid rgba(var(--cg-ink-rgb), 0.12)',
    borderRadius: 10,
    overflow: 'hidden',
    background: 'rgba(var(--cg-ink-rgb), 0.04)',
    cursor: 'zoom-in',
  },
  figureImg: {
    display: 'block',
    width: '100%',
    height: 'auto',
    // Pleine largeur : une photo haute ne doit pas occuper tout l'écran.
    maxHeight: 560,
    objectFit: 'contain',
    background: '#ffffff',
  },
  figurePlaceholder: {
    padding: 28,
    textAlign: 'center',
    borderRadius: 10,
    border: '1px dashed rgba(var(--cg-ink-rgb), 0.22)',
    fontFamily: 'var(--font-body)',
    fontSize: 14,
    color: 'rgba(var(--cg-ink-rgb), 0.6)',
  },
  figcaption: {
    marginTop: 8,
    fontFamily: 'var(--font-body)',
    fontSize: 14,
    color: 'rgba(var(--cg-ink-rgb), 0.62)',
  },
  callout: {
    margin: '0.4em 0 1.4em',
    padding: '16px 20px',
    borderRadius: 12,
    border: '1px solid var(--cg-accent-border)',
    background: 'var(--cg-accent-bg)',
    fontFamily: 'var(--font-body)',
    fontSize: '0.9em',
    lineHeight: 1.6,
  },
  calloutAlerte: {
    border: '1px solid var(--cg-danger-border)',
    background: 'var(--cg-danger-bg)',
  },
  calloutTitle: {
    marginBottom: 6,
    fontFamily: 'var(--font-mono)',
    fontSize: 12,
    fontWeight: 600,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    color: 'var(--cg-accent)',
  },
  calloutTitleAlerte: {
    color: 'var(--cg-danger)',
  },
  calloutText: {
    color: 'var(--cg-ink)',
  },
  stockSection: {
    margin: '0 0 0.4em',
  },
  stockTitleLink: {
    color: 'inherit',
    textDecoration: 'none',
    borderBottom: '2px solid var(--cg-accent-border)',
  },
  stockTitleArrow: {
    color: 'var(--cg-accent)',
  },
  stockMeta: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: '4px 14px',
    margin: '0 0 0.5em',
    fontFamily: 'var(--font-body)',
    fontSize: 13,
    color: 'rgba(var(--cg-ink-rgb), 0.62)',
  },
  stockLive: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
  },
  stockLiveDot: {
    width: 7,
    height: 7,
    borderRadius: '50%',
    background: 'var(--cg-ok)',
    flexShrink: 0,
  },
  stockRefLink: {
    color: 'var(--cg-accent)',
    textDecoration: 'none',
    fontWeight: 600,
  },
  stockArrow: {
    display: 'block',
    fontWeight: 400,
    fontSize: '0.78em',
    lineHeight: 1.2,
    color: 'rgba(var(--cg-ink-rgb), 0.6)',
  },
  stockTable: {
    fontSize: 14,
  },
  stockTh: {
    padding: '8px 10px',
    letterSpacing: '0.03em',
  },
  stockTd: {
    padding: '7px 10px',
  },
  lightbox: {
    position: 'fixed',
    inset: 0,
    zIndex: 2000,
    background: 'rgba(6,10,18,0.9)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    cursor: 'zoom-out',
  },
  lightboxImg: {
    maxWidth: '100%',
    maxHeight: '100%',
    borderRadius: 8,
    boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
  },
  lightboxClose: {
    position: 'absolute',
    top: 18,
    right: 18,
    width: 44,
    height: 44,
    borderRadius: 12,
    border: '1px solid rgba(255,255,255,0.3)',
    background: 'rgba(255,255,255,0.08)',
    color: '#ffffff',
    fontSize: 18,
    cursor: 'pointer',
  },
}
