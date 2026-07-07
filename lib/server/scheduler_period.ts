// lib/server/scheduler-period.ts
// Helper complet à importer dans le worker scheduler si tes routes d'agrégats doivent recevoir
// une période dynamique au moment du run.
//
// Usage côté scheduler :
//   import { buildSchedulerHttpBody } from './scheduler-period'
//   const body = buildSchedulerHttpBody(job.config_json || {})
//
// Puis dans fetch(...):
//   body: JSON.stringify(body)

function toIsoDate(date: Date) {
  return date.toISOString().slice(0, 10)
}

function firstDayOfMonth(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1))
}

function addDays(date: Date, days: number) {
  const d = new Date(date)
  d.setUTCDate(d.getUTCDate() + days)
  return d
}

function addMonths(date: Date, months: number) {
  const d = new Date(date)
  d.setUTCMonth(d.getUTCMonth() + months)
  return d
}

export function resolveAggregatePeriod(period: any, now = new Date()) {
  if (!period?.mode) return null

  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))

  if (period.mode === 'fixed_range') {
    return {
      date_debut: period.fromDate,
      date_fin: period.toDate,
    }
  }

  if (period.mode === 'current_month') {
    return {
      date_debut: toIsoDate(firstDayOfMonth(today)),
      date_fin: toIsoDate(addDays(today, 1)),
    }
  }

  if (period.mode === 'previous_month') {
    const startCurrent = firstDayOfMonth(today)
    const startPrevious = addMonths(startCurrent, -1)

    return {
      date_debut: toIsoDate(startPrevious),
      date_fin: toIsoDate(startCurrent),
    }
  }

  if (period.mode === 'relative_days') {
    const days = Math.max(1, Number(period.days || 1))

    return {
      date_debut: toIsoDate(addDays(today, -days)),
      date_fin: toIsoDate(addDays(today, 1)),
    }
  }

  if (period.mode === 'relative_months') {
    const months = Math.max(1, Number(period.months || 2))
    const includeCurrentMonth = period.includeCurrentMonth !== false

    const end = includeCurrentMonth
      ? addDays(today, 1)
      : firstDayOfMonth(today)

    const startBase = includeCurrentMonth
      ? firstDayOfMonth(today)
      : addMonths(firstDayOfMonth(today), -1)

    return {
      date_debut: toIsoDate(addMonths(startBase, -(months - 1))),
      date_fin: toIsoDate(end),
    }
  }

  return null
}

export function buildSchedulerHttpBody(config: any) {
  const body = {
    ...(config?.body || {}),
  }

  const resolvedPeriod = resolveAggregatePeriod(config?.period)

  if (resolvedPeriod?.date_debut && resolvedPeriod?.date_fin) {
    body.date_debut = resolvedPeriod.date_debut
    body.date_fin = resolvedPeriod.date_fin
    body.p_date_debut = resolvedPeriod.date_debut
    body.p_date_fin = resolvedPeriod.date_fin
    body.startDate = resolvedPeriod.date_debut
    body.endDate = resolvedPeriod.date_fin
  }

  return body
}
