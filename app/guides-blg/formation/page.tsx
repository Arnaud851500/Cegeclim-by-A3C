'use client'

// ============================================================================
// app/guides-blg/formation/page.tsx — Guides BLG › Formation — 10/11/2026
// ----------------------------------------------------------------------------
// Supports de formation PDF du dossier Teams « z - Formation », publiés sous le nom
// « Formation » par la synchronisation OneDrive du Mac (scripts/guides-blg-sync.ts) :
//  - l'arborescence Teams est reprise telle quelle (dossiers → sous-dossiers → PDF),
//    navigation par fil d'Ariane, URL ?dossier=<chemin relatif> ;
//  - seuls les PDF sont publiés ; un dossier sans PDF (même dans ses sous-dossiers)
//    n'apparaît pas ;
//  - recherche sur les noms de fichiers et de dossiers, tous niveaux confondus ;
//  - un PDF s'ouvre dans la page (lecteur intégré), dans un nouvel onglet ou se
//    télécharge sous son nom d'origine (URL signée, bucket privé « guides-blg »).
// Droits : lecture can_guides_blg (ou administration), comme les chapitres.
// Migration : 20261110a_guides_blg_formation.sql
// ============================================================================

import React, { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
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

type EtatRow = {
  titre: string
  icone: string
  actif: boolean
  verifie_at: string | null
  message: string | null
  nb_fichiers: number
  nb_dossiers: number
}

type SousDossier = { chemin: string; nom: string; nbPdf: number; nbDossiers: number; maj: string | null }

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
  btnPrimary: { background: '#A6A181', color: '#0B1220', border: '1px solid #A6A181', borderRadius: 8, padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' },
  error: { padding: '12px 14px', borderRadius: 10, background: 'rgba(193,104,60,0.15)', border: '1px solid rgba(193,104,60,0.5)', color: '#E07A4E', marginBottom: 16, fontSize: 13 },
  info: { padding: '10px 14px', borderRadius: 10, background: 'rgba(143,199,218,0.10)', border: '1px solid rgba(143,199,218,0.35)', color: '#8FC7DA', marginBottom: 16, fontSize: 13 },
  readerBar: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginBottom: 10 },
  frameWrap: { borderRadius: 12, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.12)', background: '#525659' },
  loading: { padding: 40, textAlign: 'center', color: '#C9CCCF', fontSize: 14 },
})

const trier = (a: string, b: string) => a.localeCompare(b, 'fr', { numeric: true, sensitivity: 'base' })
const sansPdf = (nom: string) => nom.replace(/\.pdf$/i, '')
const normaliser = (v: string) => v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const dansDossier = (f: FichierRow, dossier: string) => !dossier || f.dossier === dossier || f.dossier.startsWith(`${dossier}/`)
const dateCourte = (v: string | null) => (v ? new Date(v).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—')

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

  const [fichiers, setFichiers] = useState<FichierRow[]>([])
  const [etat, setEtat] = useState<EtatRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [recherche, setRecherche] = useState('')

  useEffect(() => {
    let active = true
    void (async () => {
      const [lignes, et] = await Promise.all([
        supabase.from('guides_blg_formation').select('chemin, dossier, nom, taille, hash, storage_path, modifie_le, updated_at'),
        supabase.from('guides_blg_formation_etat').select('titre, icone, actif, verifie_at, message, nb_fichiers, nb_dossiers').eq('id', 1).maybeSingle(),
      ])
      if (!active) return
      if (lignes.error) setError(`Lecture des supports de formation : ${lignes.error.message}`)
      setFichiers(((lignes.data ?? []) as FichierRow[]).sort((a, b) => trier(a.chemin, b.chemin)))
      setEtat((et.data as EtatRow | null) ?? null)
      setLoading(false)
    })()
    return () => {
      active = false
    }
  }, [])

  const aller = useCallback(
    (d: string, fichier?: string | null) => {
      const p = new URLSearchParams()
      if (d) p.set('dossier', d)
      if (fichier) p.set('fichier', fichier)
      const qs = p.toString()
      router.push(qs ? `/guides-blg/formation?${qs}` : '/guides-blg/formation', { scroll: true })
    },
    [router],
  )

  const titre = etat?.titre || 'Formation'
  const icone = etat?.icone || '🎓'

  // Sous-dossiers directs du dossier courant (avec PDF à l'intérieur, à tous niveaux).
  const sousDossiers: SousDossier[] = useMemo(() => {
    const map = new Map<string, SousDossier>()
    const sousDossiersDe = new Map<string, Set<string>>()
    for (const f of fichiers) {
      if (!dansDossier(f, dossier) || f.dossier === dossier) continue
      const reste = dossier ? f.dossier.slice(dossier.length + 1) : f.dossier
      const morceaux = reste.split('/')
      const nom = morceaux[0]
      const chemin = dossier ? `${dossier}/${nom}` : nom
      const sd = map.get(chemin) ?? { chemin, nom, nbPdf: 0, nbDossiers: 0, maj: null }
      sd.nbPdf++
      const maj = f.modifie_le ?? f.updated_at
      if (!sd.maj || maj > sd.maj) sd.maj = maj
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
  }, [fichiers, dossier])

  const pdfs = useMemo(() => fichiers.filter((f) => f.dossier === dossier).sort((a, b) => trier(a.nom, b.nom)), [fichiers, dossier])

  const resultats = useMemo(() => {
    const q = normaliser(recherche.trim())
    if (q.length < 2) return []
    const mots = q.split(/\s+/).filter(Boolean)
    return fichiers.filter((f) => {
      const cible = normaliser(f.chemin)
      return mots.every((m) => cible.includes(m))
    })
  }, [fichiers, recherche])

  const dossierExiste = !dossier || fichiers.some((f) => dansDossier(f, dossier))
  const pdfCourant = fichierOuvert ? fichiers.find((f) => f.chemin === fichierOuvert) ?? null : null

  const segments = dossier ? dossier.split('/') : []
  const filAriane = (
    <div style={s.crumbs}>
      <button type="button" style={s.crumb} onClick={() => router.push('/guides-blg')}>Guides BLG</button>
      <span style={s.sep}>›</span>
      {segments.length === 0 && !pdfCourant ? (
        <span style={s.crumbCurrent}>{titre}</span>
      ) : (
        <button type="button" style={s.crumb} onClick={() => aller('')}>{titre}</button>
      )}
      {segments.map((seg, i) => {
        const chemin = segments.slice(0, i + 1).join('/')
        const dernier = i === segments.length - 1 && !pdfCourant
        return (
          <React.Fragment key={chemin}>
            <span style={s.sep}>›</span>
            {dernier ? <span style={s.crumbCurrent}>{seg}</span> : <button type="button" style={s.crumb} onClick={() => aller(chemin)}>{seg}</button>}
          </React.Fragment>
        )
      })}
      {pdfCourant && (
        <>
          <span style={s.sep}>›</span>
          <span style={s.crumbCurrent}>{sansPdf(pdfCourant.nom)}</span>
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

  // ── Dossier ──────────────────────────────────────────────────────────────
  const q = recherche.trim()
  return (
    <div style={s.page}>
      <div style={s.header}>
        <div style={s.headIcon}>{icone}</div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h1 style={s.title}>{segments.length ? segments[segments.length - 1] : titre}</h1>
          <p style={s.subtitle}>
            Supports de formation BLG (PDF), rangés comme dans Teams.
            {etat?.verifie_at ? ` Synchronisé le ${new Date(etat.verifie_at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}.` : ''}
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

      {loading ? (
        <div style={s.muted}>Chargement…</div>
      ) : q.length >= 2 ? (
        <>
          <div style={s.sectionTitle}>{resultats.length} résultat{resultats.length > 1 ? 's' : ''}</div>
          {resultats.length === 0 ? (
            <div style={s.muted}>Aucun support ne correspond.</div>
          ) : (
            <div style={s.files}>
              {resultats.map((f) => (
                <LigneFichier key={f.chemin} f={f} avecDossier onOuvrir={() => aller(f.dossier, f.chemin)} />
              ))}
            </div>
          )}
        </>
      ) : !fichiers.length ? (
        <div style={s.info}>Aucun support de formation publié pour le moment.</div>
      ) : !dossierExiste ? (
        <div style={s.info}>
          Ce dossier n’existe plus ou ne contient aucun PDF.{' '}
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
                        {sd.nbDossiers > 0 ? `${sd.nbDossiers} dossier${sd.nbDossiers > 1 ? 's' : ''} · ` : ''}
                        {sd.nbPdf} PDF · MAJ {dateCourte(sd.maj)}
                      </span>
                    </button>
                  )
                })}
              </div>
            </>
          )}
          {pdfs.length > 0 && (
            <>
              <div style={s.sectionTitle}>Documents</div>
              <div style={s.files}>
                {pdfs.map((f) => (
                  <LigneFichier key={f.chemin} f={f} onOuvrir={() => aller(f.dossier, f.chemin)} />
                ))}
              </div>
            </>
          )}
        </>
      )}

      {!loading && etat?.message && <div style={{ ...s.muted, marginTop: 26 }}>{etat.message}</div>}
    </div>
  )
}

function LigneFichier({ f, avecDossier = false, onOuvrir }: { f: FichierRow; avecDossier?: boolean; onOuvrir: () => void }) {
  return (
    <div
      style={s.file}
      onClick={onOuvrir}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = tc('#A6A181'))}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = tc('rgba(255,255,255,0.08)'))}
    >
      <div style={s.fileIcon}>📄</div>
      <div style={{ minWidth: 0 }}>
        <div style={s.fileName}>{sansPdf(f.nom)}</div>
        <div style={s.fileMeta}>
          {avecDossier ? `${f.dossier ? f.dossier.split('/').join(' › ') : 'Formation'} · ` : ''}
          PDF · {formatTaille(f.taille)} · modifié le {dateCourte(f.modifie_le)}
        </div>
      </div>
      <span style={{ ...s.muted, marginLeft: 'auto', whiteSpace: 'nowrap' }}>Ouvrir ›</span>
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
          📄 {sansPdf(fichier.nom)}
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
