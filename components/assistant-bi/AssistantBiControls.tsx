'use client'

import type { ReactNode } from 'react'
import { assistantBiPageStyles as styles } from './assistantBiPageStyles'

export function Step({ number, title, children }: { number: string; title: string; children: ReactNode }) {
  return (
    <section style={styles.step}>
      <div style={styles.stepTitle}>
        <span style={styles.stepNumber}>{number}</span>
        <strong>{title}</strong>
      </div>
      {children}
    </section>
  )
}

export function ChoiceButton({
  active,
  title,
  description,
  onClick,
  compact = false,
}: {
  active: boolean
  title: string
  description: string
  onClick: () => void
  compact?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ ...styles.choice, ...(compact ? styles.choiceCompact : {}), ...(active ? styles.choiceActive : {}) }}
    >
      <strong>{title}</strong>
      <span>{description}</span>
    </button>
  )
}

export function PlanLine({ label, value }: { label: string; value: string }) {
  return <div style={styles.planLine}><span>{label}</span><strong>{value}</strong></div>
}

export function ToggleChoice({ value, onChange }: { value: boolean; onChange: (value: boolean) => void }) {
  return (
    <div style={styles.toggleRow}>
      <button type="button" onClick={() => onChange(true)} style={{ ...styles.toggleButton, ...(value ? styles.toggleActive : {}) }}>OUI</button>
      <button type="button" onClick={() => onChange(false)} style={{ ...styles.toggleButton, ...(!value ? styles.toggleActive : {}) }}>NON</button>
    </div>
  )
}
