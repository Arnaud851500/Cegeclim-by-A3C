'use client'

/**
 * Saisie d'une date au format JJ/MM/AA (20/11/2026, demande d'Arnaud : date de
 * mise en service). Les « / » s'ajoutent tout seuls ; la valeur transmise est
 * la date ISO (AAAA-MM-JJ) attendue en base, ou '' tant que la saisie est
 * incomplète ou invalide.
 */

import { useState } from 'react'

export function isoVersCourte(iso: string | null | undefined) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '')
  return m ? `${m[3]}/${m[2]}/${m[1].slice(2)}` : ''
}

function courteVersIso(texte: string) {
  const m = /^(\d{2})\/(\d{2})\/(\d{2}|\d{4})$/.exec(texte.trim())
  if (!m) return ''
  const annee = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])
  const mois = Number(m[2])
  const jour = Number(m[1])
  const d = new Date(Date.UTC(annee, mois - 1, jour))
  if (d.getUTCFullYear() !== annee || d.getUTCMonth() !== mois - 1 || d.getUTCDate() !== jour) return ''
  return `${annee}-${String(mois).padStart(2, '0')}-${String(jour).padStart(2, '0')}`
}

function masquer(brut: string) {
  const chiffres = brut.replace(/\D/g, '').slice(0, 6)
  return [chiffres.slice(0, 2), chiffres.slice(2, 4), chiffres.slice(4, 6)].filter(Boolean).join('/')
}

export default function ChampDateCourte({ value, onChange, className }: { value: string; onChange: (iso: string) => void; className: string }) {
  // Texte en cours de saisie ; hors saisie, on affiche la valeur reçue.
  const [saisie, setSaisie] = useState<string | null>(null)
  const texte = saisie ?? isoVersCourte(value)
  const invalide = saisie !== null && saisie.length === 8 && !courteVersIso(saisie)
  return (
    <input
      value={texte}
      inputMode="numeric"
      placeholder="JJ/MM/AA"
      maxLength={8}
      onChange={(e) => {
        const t = masquer(e.target.value)
        setSaisie(t)
        const iso = courteVersIso(t)
        if (iso || !t) onChange(iso)
      }}
      onBlur={() => setSaisie(null)}
      title={invalide ? 'Date invalide' : 'Format JJ/MM/AA'}
      className={`${className} w-[92px] ${invalide ? 'border-[#C81E1E] text-[#C81E1E]' : ''}`}
    />
  )
}
