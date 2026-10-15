'use client'

// ============================================================================
// app/actualites/page.tsx — Fil d'actualité (13/10/2026)
// ----------------------------------------------------------------------------
// Écran ouvert depuis le bandeau défilant (clic sur une actualité ou « Tout
// voir ») et depuis « Nouveau dans votre compagnon ».
//   - à gauche : liste des publications (recherche, onglets Actualités /
//     Nouveautés, filtre par catégorie), date de diffusion, repère « non lu »,
//     mention « Masquée du bandeau » ;
//   - à droite : la publication choisie en mise en page de lecture
//     (?id=… dans l'adresse, partageable) ; bouton « Ne plus afficher dans le
//     bandeau » / « Réafficher » ;
//   - rédacteurs : Publier, Modifier, Archiver, Supprimer ; brouillons et
//     publications programmées visibles avec leur statut ;
//   - administrateurs : gestion de la liste des rédacteurs.
// Page libre (hors arborescence) : accessible à tout utilisateur connecté.
// ÉVOLUTION (2026-10-14) : sur téléphone, la page affiche la version mobile
// (components/mobile/MobileFilActu.tsx). Les lecteurs PC ne voient que les
// publications « PC » ; les rédacteurs voient tout, avec la mention de la
// plateforme quand elle n'est pas « PC et mobile ».
// ============================================================================

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import type React from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { useViewport } from '@/lib/useViewport'
import { MobileActualitesStandalone } from '@/components/mobile/MobileFilActu'
import { useTheme } from '@/components/ThemeContext'
import ActualiteContent from '@/components/actualites/ActualiteContent'
import {
  ACTUALITE_CATEGORIES,
  ACTUALITES_CHANGED_EVENT,
  ACTUALITES_EDIT_PATH,
  ACTUALITES_PATH,
  categoryTone,
  fetchFlux,
  formatDateDiffusion,
  formatDateLongue,
  marquerActualites,
  notifyActualitesChanged,
  libellePlateformes,
  resumeOf,
  tempsLecture,
  usePeutPublier,
  type Actualite,
  type ActualiteType,
} from '@/lib/actualites'

type Redacteur = { email: string; nom: string | null }

function statutLabel(item: Actualite): { label: string; tone: 'draft' | 'scheduled' | 'archived' } | null {
  if (item.statut === 'brouillon') return { label: 'Brouillon', tone: 'draft' }
  if (item.statut === 'archive') return { label: 'Archivée', tone: 'archived' }
  if (new Date(item.date_diffusion).getTime() > Date.now()) {
    return { label: `Programmée le ${formatDateDiffusion(item.date_diffusion)}`, tone: 'scheduled' }
  }
  return null
}

function FilActualite() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { theme } = useTheme()
  const { peutPublier, isAdmin } = usePeutPublier()

  const [items, setItems] = useState<Actualite[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [categorie, setCategorie] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const typeParam = searchParams.get('type') === 'nouveaute' ? 'nouveaute' : 'actualite'
  const [tab, setTab] = useState<ActualiteType>(typeParam)
  const selectedId = searchParams.get('id')

  const load = useCallback(async () => {
    try {
      const rows = await fetchFlux({ publieesSeulement: !peutPublier, plateforme: peutPublier ? null : 'pc' })
      setItems(rows)
      setError(null)
    } catch (err) {
      const message = err instanceof Error ? err.message : String((err as { message?: string })?.message || err)
      setError(
        /get_actualites_flux|does not exist|schema cache/i.test(message)
          ? 'Le fil d’actualité n’est pas encore activé : le script SQL 20261013_fil_actualite_nouveautes.sql doit être exécuté dans Supabase.'
          : `Chargement impossible : ${message}`
      )
    } finally {
      setLoading(false)
    }
  }, [peutPublier])

  useEffect(() => {
    void load()
    const onChange = () => void load()
    window.addEventListener(ACTUALITES_CHANGED_EVENT, onChange)
    return () => window.removeEventListener(ACTUALITES_CHANGED_EVENT, onChange)
  }, [load])

  // L'onglet suit la publication ouverte (lien direct vers une nouveauté).
  useEffect(() => {
    if (!selectedId) return
    const item = items.find((row) => row.id === selectedId)
    if (item && item.type !== tab) setTab(item.type)
  }, [selectedId, items, tab])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items.filter((item) => {
      if (item.type !== tab) return false
      if (categorie && (item.categorie || '') !== categorie) return false
      if (!q) return true
      return `${item.titre} ${item.categorie || ''} ${resumeOf(item, 2000)}`.toLowerCase().includes(q)
    })
  }, [items, tab, categorie, search])

  const categories = useMemo(() => {
    const used = new Set(items.filter((item) => item.type === tab && item.categorie).map((item) => item.categorie as string))
    return [...ACTUALITE_CATEGORIES.filter((c) => used.has(c)), ...[...used].filter((c) => !ACTUALITE_CATEGORIES.includes(c)).sort()]
  }, [items, tab])

  const selected = useMemo(() => {
    if (selectedId) return items.find((item) => item.id === selectedId) || null
    return visible[0] || null
  }, [selectedId, items, visible])

  // Marque lue la publication affichée.
  useEffect(() => {
    if (!selected || selected.lu || selected.statut !== 'publie') return
    const id = selected.id
    setItems((current) => current.map((item) => (item.id === id ? { ...item, lu: true } : item)))
    void marquerActualites([id], { lu: true }).catch(() => {})
  }, [selected])

  const select = (id: string) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set('id', id)
    params.set('type', tab)
    router.replace(`${ACTUALITES_PATH}?${params.toString()}`, { scroll: false })
  }

  const switchTab = (next: ActualiteType) => {
    setTab(next)
    setCategorie(null)
    router.replace(`${ACTUALITES_PATH}?type=${next}`, { scroll: false })
  }

  const toggleBandeau = async (item: Actualite) => {
    const masque = !item.masque_bandeau
    setItems((current) => current.map((row) => (row.id === item.id ? { ...row, masque_bandeau: masque } : row)))
    try {
      await marquerActualites([item.id], { lu: null, masque })
    } catch {
      setItems((current) => current.map((row) => (row.id === item.id ? { ...row, masque_bandeau: !masque } : row)))
    }
  }

  const setStatut = async (item: Actualite, statut: Actualite['statut']) => {
    setBusy(true)
    const { error: err } = await supabase.from('actualites').update({ statut }).eq('id', item.id)
    setBusy(false)
    if (err) {
      window.alert(`Modification impossible : ${err.message}`)
      return
    }
    notifyActualitesChanged()
  }

  const remove = async (item: Actualite) => {
    if (!window.confirm(`Supprimer définitivement « ${item.titre} » ?`)) return
    setBusy(true)
    const { error: err } = await supabase.from('actualites').delete().eq('id', item.id)
    setBusy(false)
    if (err) {
      window.alert(`Suppression impossible : ${err.message}`)
      return
    }
    router.replace(`${ACTUALITES_PATH}?type=${tab}`, { scroll: false })
    notifyActualitesChanged()
  }

  const counts = useMemo(
    () => ({
      actualite: items.filter((i) => i.type === 'actualite').length,
      nouveaute: items.filter((i) => i.type === 'nouveaute').length,
    }),
    [items]
  )

  const selectedTone = selected ? categoryTone(selected.categorie, theme) : null
  const selectedStatut = selected ? statutLabel(selected) : null

  return (
    <div style={styles.page}>
      <style>{`
        .cgcActuItem:hover { border-color: rgba(var(--cg-ink-rgb), 0.28) !important; }
        .cgcActuItem:focus-visible, .cgcActuBtn:focus-visible { outline: 2px solid var(--cg-accent); outline-offset: 2px; }
        .cgcActuBtn:hover { filter: brightness(1.06); }
      `}</style>

      <aside style={styles.aside}>
        <div style={styles.asideHead}>
          <div>
            <h1 style={styles.h1}>Fil d’actualité</h1>
            <p style={styles.lead}>Informations utiles au commerce et nouveautés du compagnon, de la plus récente à la plus ancienne.</p>
          </div>
          {peutPublier ? (
            <button
              type="button"
              className="cgcActuBtn"
              onClick={() => router.push(`${ACTUALITES_EDIT_PATH}?type=${tab}`)}
              style={styles.primaryBtn}
            >
              + Publier
            </button>
          ) : null}
        </div>

        <div role="tablist" aria-label="Type de publication" style={styles.tabs}>
          {(['actualite', 'nouveaute'] as ActualiteType[]).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              onClick={() => switchTab(value)}
              style={{ ...styles.tab, ...(tab === value ? styles.tabActive : {}) }}
            >
              {value === 'actualite' ? 'Actualités' : 'Nouveautés du compagnon'}
              <span style={styles.tabCount}>{counts[value]}</span>
            </button>
          ))}
        </div>

        <label style={styles.searchLabel}>
          <span style={styles.srOnly}>Rechercher</span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Rechercher : référence, opération, agence…"
            style={styles.search}
          />
        </label>

        {categories.length > 0 ? (
          <div style={styles.chips}>
            <button type="button" onClick={() => setCategorie(null)} style={{ ...styles.chip, ...(categorie === null ? styles.chipActive : {}) }}>
              Toutes
            </button>
            {categories.map((c) => {
              const tone = categoryTone(c, theme)
              const active = categorie === c
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCategorie(active ? null : c)}
                  aria-pressed={active}
                  style={{ ...styles.chip, background: tone.bg, color: tone.fg, ...(active ? styles.chipPicked : {}) }}
                >
                  {c}
                </button>
              )
            })}
          </div>
        ) : null}

        <div style={styles.list}>
          {loading ? <div style={styles.muted}>Chargement…</div> : null}
          {!loading && error ? <div style={styles.errorBox}>{error}</div> : null}
          {!loading && !error && visible.length === 0 ? (
            <div style={styles.muted}>
              {search || categorie ? 'Aucune publication ne correspond à la recherche.' : 'Aucune publication pour le moment.'}
            </div>
          ) : null}
          {visible.map((item) => {
            const tone = categoryTone(item.categorie, theme)
            const active = selected?.id === item.id
            const statut = statutLabel(item)
            return (
              <button
                key={item.id}
                type="button"
                className="cgcActuItem"
                onClick={() => select(item.id)}
                aria-current={active ? 'true' : undefined}
                style={{ ...styles.item, ...(active ? styles.itemActive : {}) }}
              >
                <span style={styles.itemMeta}>
                  {item.epingle ? <span style={styles.pin} title="Épinglée en tête du fil">Épinglée</span> : null}
                  {item.categorie ? <span style={{ ...styles.tag, background: tone.bg, color: tone.fg }}>{item.categorie}</span> : null}
                  <span>Diffusé le {formatDateDiffusion(item.date_diffusion)}</span>
                  {!item.lu && item.statut === 'publie' && !active ? <span style={styles.unread}>● Non lu</span> : null}
                </span>
                <span style={{ ...styles.itemTitle, fontWeight: item.lu || active ? 600 : 700 }}>{item.titre}</span>
                <span style={styles.itemResume}>{resumeOf(item, 130)}</span>
                {statut || (item.type === 'actualite' && item.masque_bandeau) || (peutPublier && item.plateformes.length === 1) ? (
                  <span style={styles.itemFlags}>
                    {statut ? <span style={styles.statut}>{statut.label}</span> : null}
                    {peutPublier && item.plateformes.length === 1 ? <span>{libellePlateformes(item.plateformes)}</span> : null}
                    {item.type === 'actualite' && item.masque_bandeau ? <span>Masquée du bandeau</span> : null}
                  </span>
                ) : null}
              </button>
            )
          })}
        </div>

        {isAdmin ? <RedacteursPanel /> : null}
      </aside>

      <article style={styles.article}>
        {selected ? (
          <div style={styles.reading}>
            <div style={styles.articleMeta}>
              {selected.categorie && selectedTone ? (
                <span style={{ ...styles.tag, fontSize: 12, background: selectedTone.bg, color: selectedTone.fg }}>{selected.categorie}</span>
              ) : null}
              <span>Diffusé le {formatDateLongue(selected.date_diffusion)}</span>
              {selectedStatut ? <span style={styles.statut}>{selectedStatut.label}</span> : null}
              {peutPublier && selected.plateformes.length === 1 ? <span>{libellePlateformes(selected.plateformes)}</span> : null}
            </div>
            <h2 style={styles.h2}>{selected.titre}</h2>
            <div style={styles.byline}>
              <span>
                Publié par {selected.auteur_nom || selected.auteur_email || '—'} · lecture {tempsLecture(selected)}
                {selected.cible_agences.length > 0 ? ` · agences : ${selected.cible_agences.join(', ')}` : ''}
              </span>
              <span style={styles.actions}>
                {selected.type === 'actualite' && selected.statut === 'publie' ? (
                  <button type="button" className="cgcActuBtn" onClick={() => void toggleBandeau(selected)} style={styles.secondaryBtn}>
                    {selected.masque_bandeau ? 'Réafficher dans le bandeau' : 'Ne plus afficher dans le bandeau'}
                  </button>
                ) : null}
                {peutPublier ? (
                  <>
                    <button
                      type="button"
                      className="cgcActuBtn"
                      onClick={() => router.push(`${ACTUALITES_EDIT_PATH}?id=${selected.id}`)}
                      style={styles.secondaryBtn}
                    >
                      Modifier
                    </button>
                    {selected.statut === 'archive' ? (
                      <button type="button" className="cgcActuBtn" disabled={busy} onClick={() => void setStatut(selected, 'publie')} style={styles.secondaryBtn}>
                        Republier
                      </button>
                    ) : selected.statut === 'publie' ? (
                      <button type="button" className="cgcActuBtn" disabled={busy} onClick={() => void setStatut(selected, 'archive')} style={styles.secondaryBtn}>
                        Archiver
                      </button>
                    ) : null}
                    <button type="button" className="cgcActuBtn" disabled={busy} onClick={() => void remove(selected)} style={styles.dangerBtn}>
                      Supprimer
                    </button>
                  </>
                ) : null}
              </span>
            </div>
            {selected.contenu.length > 0 ? (
              <ActualiteContent blocks={selected.contenu} />
            ) : (
              <p style={styles.muted}>Cette publication n’a pas encore de contenu.</p>
            )}
          </div>
        ) : (
          <div style={styles.emptyArticle}>
            {loading ? 'Chargement…' : 'Choisissez une publication dans la liste.'}
          </div>
        )}
      </article>
    </div>
  )
}

function RedacteursPanel() {
  const [rows, setRows] = useState<Redacteur[]>([])
  const [email, setEmail] = useState('')
  const [nom, setNom] = useState('')
  const [message, setMessage] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('actualites_redacteurs').select('email, nom').order('email')
    if (!error) setRows((data || []) as Redacteur[])
  }, [])

  useEffect(() => {
    // Chargement asynchrone : setState après la réponse réseau.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  const add = async (event: React.FormEvent) => {
    event.preventDefault()
    const value = email.trim().toLowerCase()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) {
      setMessage('Adresse e-mail invalide.')
      return
    }
    const { error } = await supabase.from('actualites_redacteurs').upsert({ email: value, nom: nom.trim() || null })
    if (error) {
      setMessage(`Ajout impossible : ${error.message}`)
      return
    }
    setEmail('')
    setNom('')
    setMessage(null)
    void load()
  }

  const removeRow = async (row: Redacteur) => {
    if (!window.confirm(`Retirer ${row.email} des rédacteurs ?`)) return
    const { error } = await supabase.from('actualites_redacteurs').delete().eq('email', row.email)
    if (error) setMessage(`Retrait impossible : ${error.message}`)
    else void load()
  }

  return (
    <details style={styles.redacteurs}>
      <summary style={styles.redacteursSummary}>Rédacteurs ({rows.length}) — réservé aux administrateurs</summary>
      <p style={styles.redacteursHelp}>
        Les administrateurs publient toujours. Ajoutez ici les autres personnes autorisées à publier dans le fil et les nouveautés.
      </p>
      <ul style={styles.redacteursList}>
        {rows.map((row) => (
          <li key={row.email} style={styles.redacteurRow}>
            <span style={{ minWidth: 0 }}>
              <span style={{ fontWeight: 600 }}>{row.nom || row.email}</span>
              {row.nom ? <span style={styles.redacteurEmail}> {row.email}</span> : null}
            </span>
            <button type="button" onClick={() => void removeRow(row)} style={styles.linkDanger}>Retirer</button>
          </li>
        ))}
        {rows.length === 0 ? <li style={styles.muted}>Aucun rédacteur déclaré.</li> : null}
      </ul>
      <form onSubmit={add} style={styles.redacteurForm}>
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="prenom.nom@cegeclim-energies.com" style={styles.input} aria-label="E-mail du rédacteur" />
        <input type="text" value={nom} onChange={(e) => setNom(e.target.value)} placeholder="Nom affiché (facultatif)" style={styles.input} aria-label="Nom affiché" />
        <button type="submit" className="cgcActuBtn" style={styles.secondaryBtn}>Ajouter</button>
      </form>
      {message ? <div style={styles.errorBox}>{message}</div> : null}
    </details>
  )
}

function ActualitesSelonEcran() {
  const { isMobile } = useViewport()
  const router = useRouter()
  const searchParams = useSearchParams()
  if (isMobile) {
    return (
      <MobileActualitesStandalone
        initialId={searchParams.get('id')}
        initialTab={searchParams.get('type') === 'nouveaute' ? 'nouveaute' : 'actualite'}
        onExit={() => router.push('/accueil')}
      />
    )
  }
  return <FilActualite />
}

export default function ActualitesPage() {
  return (
    <Suspense fallback={<div style={{ padding: 24, color: 'rgba(var(--cg-ink-rgb), 0.6)' }}>Chargement…</div>}>
      <ActualitesSelonEcran />
    </Suspense>
  )
}

// 15/10/2026 (demandé par Arnaud) : la page utilise davantage la largeur de
// l'écran ; le texte reste sur une colonne de lecture de LARGEUR_TEXTE px,
// les tableaux (dont les tableaux stock en direct) prennent toute la largeur
// de l'article pour éviter le défilement horizontal.
// 15/10/2026 bis : plus de colonne de lecture — tout le contenu (texte, photo,
// encadrés, tableaux) s'aligne sur la largeur de l'article.

const styles: Record<string, React.CSSProperties> = {
  page: {
    maxWidth: 1720,
    margin: '0 auto',
    padding: '10px 4px 40px',
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    gap: 24,
    color: 'var(--cg-ink)',
    fontFamily: 'var(--font-body)',
  },
  aside: {
    flex: '1 1 300px',
    maxWidth: 380,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
  },
  asideHead: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  h1: {
    margin: 0,
    fontFamily: 'var(--font-display)',
    fontSize: 30,
    fontWeight: 700,
    letterSpacing: '-0.01em',
  },
  lead: {
    margin: '4px 0 0',
    fontSize: 14,
    lineHeight: 1.45,
    color: 'rgba(var(--cg-ink-rgb), 0.65)',
  },
  primaryBtn: {
    flexShrink: 0,
    padding: '10px 14px',
    borderRadius: 9,
    border: 'none',
    background: 'var(--cg-accent)',
    color: 'var(--cg-bg)',
    fontWeight: 700,
    fontSize: 14,
    cursor: 'pointer',
  },
  secondaryBtn: {
    padding: '8px 12px',
    borderRadius: 8,
    border: '1px solid rgba(var(--cg-ink-rgb), 0.2)',
    background: 'transparent',
    color: 'var(--cg-ink)',
    fontWeight: 500,
    fontSize: 13.5,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  dangerBtn: {
    padding: '8px 12px',
    borderRadius: 8,
    border: '1px solid var(--cg-danger-border)',
    background: 'transparent',
    color: 'var(--cg-danger)',
    fontWeight: 500,
    fontSize: 13.5,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  tabs: {
    display: 'flex',
    gap: 4,
    padding: 4,
    borderRadius: 12,
    background: 'rgba(var(--cg-ink-rgb), 0.05)',
    border: '1px solid rgba(var(--cg-ink-rgb), 0.08)',
  },
  tab: {
    flex: 1,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: '9px 10px',
    borderRadius: 9,
    border: 'none',
    background: 'transparent',
    color: 'rgba(var(--cg-ink-rgb), 0.7)',
    fontSize: 13.5,
    fontWeight: 600,
    cursor: 'pointer',
  },
  tabActive: {
    background: 'var(--cg-surface)',
    color: 'var(--cg-ink)',
    boxShadow: '0 1px 3px rgba(0,0,0,calc(0.25 * var(--cg-shadow-k)))',
  },
  tabCount: {
    fontFamily: 'var(--font-mono)',
    fontSize: 11,
    color: 'rgba(var(--cg-ink-rgb), 0.55)',
  },
  searchLabel: {
    display: 'block',
  },
  srOnly: {
    position: 'absolute',
    width: 1,
    height: 1,
    overflow: 'hidden',
    clip: 'rect(0 0 0 0)',
    whiteSpace: 'nowrap',
  },
  search: {
    width: '100%',
    boxSizing: 'border-box',
    padding: '10px 12px',
    borderRadius: 9,
    border: '1px solid rgba(var(--cg-ink-rgb), 0.18)',
    background: 'var(--cg-surface)',
    color: 'var(--cg-ink)',
    fontSize: 14.5,
    fontFamily: 'inherit',
  },
  chips: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
  },
  chip: {
    padding: '6px 12px',
    borderRadius: 999,
    border: '2px solid transparent',
    background: 'rgba(var(--cg-ink-rgb), 0.06)',
    color: 'var(--cg-ink)',
    fontSize: 12.5,
    fontWeight: 600,
    cursor: 'pointer',
  },
  chipActive: {
    background: 'var(--cg-ink)',
    color: 'var(--cg-bg)',
  },
  chipPicked: {
    borderColor: 'var(--cg-ink)',
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  item: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 6,
    width: '100%',
    padding: '13px 15px',
    borderRadius: 12,
    border: '1px solid rgba(var(--cg-ink-rgb), 0.12)',
    background: 'rgba(var(--cg-ink-rgb), 0.03)',
    color: 'var(--cg-ink)',
    textAlign: 'left',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  itemActive: {
    border: '1px solid var(--cg-accent)',
    background: 'var(--cg-surface)',
    boxShadow: '0 0 0 1px var(--cg-accent)',
  },
  itemMeta: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
    fontFamily: 'var(--font-mono)',
    fontSize: 11.5,
    color: 'rgba(var(--cg-ink-rgb), 0.62)',
  },
  tag: {
    fontFamily: 'var(--font-body)',
    fontSize: 11,
    fontWeight: 700,
    borderRadius: 4,
    padding: '2px 8px',
  },
  pin: {
    fontFamily: 'var(--font-body)',
    fontSize: 11,
    fontWeight: 700,
    color: 'var(--cg-sauge-ink)',
    background: 'rgba(166,161,129,0.22)',
    borderRadius: 4,
    padding: '2px 7px',
  },
  unread: {
    color: 'var(--cg-accent)',
    fontWeight: 600,
  },
  itemTitle: {
    fontSize: 15.5,
    lineHeight: 1.35,
  },
  itemResume: {
    fontSize: 13,
    lineHeight: 1.45,
    color: 'rgba(var(--cg-ink-rgb), 0.66)',
  },
  itemFlags: {
    display: 'flex',
    gap: 10,
    flexWrap: 'wrap',
    fontSize: 12,
    color: 'rgba(var(--cg-ink-rgb), 0.62)',
  },
  statut: {
    fontFamily: 'var(--font-body)',
    fontSize: 11.5,
    fontWeight: 700,
    color: 'var(--cg-warn-ink)',
  },
  article: {
    flex: '999 1 560px',
    minWidth: 0,
    borderRadius: 18,
    border: '1px solid rgba(var(--cg-ink-rgb), 0.10)',
    background: 'var(--cg-surface)',
    padding: 'clamp(20px, 3vw, 40px) clamp(16px, 2.6vw, 40px)',
    boxShadow: '0 10px 30px rgba(0,0,0,calc(0.25 * var(--cg-shadow-k)))',
  },
  reading: {
    maxWidth: 1240,
    margin: '0 auto',
  },
  articleMeta: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
    fontFamily: 'var(--font-mono)',
    fontSize: 12.5,
    color: 'rgba(var(--cg-ink-rgb), 0.65)',
  },
  h2: {
    margin: '14px 0 10px',
    fontFamily: 'var(--font-display)',
    fontSize: 'clamp(26px, 3vw, 34px)',
    fontWeight: 700,
    lineHeight: 1.18,
    letterSpacing: '-0.01em',
  },
  byline: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    flexWrap: 'wrap',
    paddingBottom: 18,
    marginBottom: 26,
    borderBottom: '1px solid rgba(var(--cg-ink-rgb), 0.10)',
    fontSize: 13.5,
    color: 'rgba(var(--cg-ink-rgb), 0.65)',
  },
  actions: {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap',
  },
  emptyArticle: {
    padding: 40,
    textAlign: 'center',
    color: 'rgba(var(--cg-ink-rgb), 0.6)',
  },
  muted: {
    fontSize: 14,
    color: 'rgba(var(--cg-ink-rgb), 0.6)',
  },
  errorBox: {
    padding: '12px 14px',
    borderRadius: 10,
    border: '1px solid var(--cg-danger-border)',
    background: 'var(--cg-danger-bg)',
    color: 'var(--cg-danger-text)',
    fontSize: 13.5,
    lineHeight: 1.45,
  },
  redacteurs: {
    marginTop: 6,
    padding: '12px 14px',
    borderRadius: 12,
    border: '1px dashed rgba(var(--cg-ink-rgb), 0.2)',
    fontSize: 13.5,
  },
  redacteursSummary: {
    cursor: 'pointer',
    fontWeight: 600,
  },
  redacteursHelp: {
    margin: '8px 0',
    color: 'rgba(var(--cg-ink-rgb), 0.65)',
    lineHeight: 1.45,
  },
  redacteursList: {
    listStyle: 'none',
    margin: '0 0 10px',
    padding: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  redacteurRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  redacteurEmail: {
    fontFamily: 'var(--font-mono)',
    fontSize: 11.5,
    color: 'rgba(var(--cg-ink-rgb), 0.6)',
  },
  redacteurForm: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
  },
  input: {
    flex: '1 1 180px',
    minWidth: 0,
    padding: '8px 10px',
    borderRadius: 8,
    border: '1px solid rgba(var(--cg-ink-rgb), 0.18)',
    background: 'var(--cg-surface)',
    color: 'var(--cg-ink)',
    fontSize: 13.5,
    fontFamily: 'inherit',
  },
  linkDanger: {
    border: 'none',
    background: 'transparent',
    color: 'var(--cg-danger)',
    cursor: 'pointer',
    fontSize: 13,
    padding: '4px 6px',
  },
}
