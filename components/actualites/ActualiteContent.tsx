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
// ============================================================================

import { Fragment, useEffect, useMemo, useState } from 'react'
import type React from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { isInternalUrl, safeUrl, useSignedImages, type Block } from '@/lib/actualites'

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

// ── Rendu ────────────────────────────────────────────────────────────────────
export default function ActualiteContent({
  blocks,
  compact = false,
  style,
}: {
  blocks: Block[]
  compact?: boolean
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
            return (
              <div key={index} style={styles.tableWrap}>
                <table style={styles.table}>
                  {head ? (
                    <thead>
                      <tr>
                        {head.map((cell, c) => (
                          <th key={c} style={styles.th}>{cell}</th>
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
                              // Cellules courtes (références, dates) sur une ligne : le tableau défile.
                              ...(String(cell || '').length <= 20 ? { whiteSpace: 'nowrap' } : {}),
                              ...(isNumericCell(String(cell || '')) ? styles.tdNum : {}),
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
      })}
    </div>
  )
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
