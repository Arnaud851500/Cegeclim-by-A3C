'use client'

// Croix de positionnement vs N-1 (inspirée du « Point commerce » PowerPoint) :
//   axe horizontal = évolution du CA cumulé à fin de trimestre vs N-1
//                    (droite « Ça va », gauche « Ça va pas ») ;
//   axe vertical   = tendance : évolution du trimestre − évolution cumulée au
//                    trimestre précédent (haut « Ça va mieux », bas « Ça se dégrade »).
// Chaque entité laisse une trace T1 → T2 → T3… ; la bulle (taille = CA N à
// date) est posée sur le trimestre choisi (par défaut le dernier clos).

import { useMemo, useState } from 'react'
import { fmtK, fmtPct, fmtPts, type Position } from '@/lib/suiviAgences'

export type CrossPoint = {
  key: string
  label: string
  positions: Position[]
  poids: number
  reference?: boolean
}

const W = 620
const H = 500
const PAD = { l: 44, r: 24, t: 30, b: 40 }

/** Borne d'axe calée sur les bulles du trimestre affiché ; les points de
 * trajectoire plus extrêmes sont posés sur le bord (valeur réelle dans
 * l'infobulle). */
function niceBound(values: number[], min: number) {
  const max = Math.max(min, ...values.map((v) => Math.abs(v)) ) * 1.12
  const step = max > 60 ? 20 : max > 30 ? 10 : 5
  return Math.ceil(max / step) * step
}

export default function PositionCross({
  points,
  nbTrimestres,
  onSelect,
}: {
  points: CrossPoint[]
  nbTrimestres: number
  onSelect?: (key: string) => void
}) {
  const [trim, setTrim] = useState<number>(0) // 0 = dernier trimestre clos
  const [traces, setTraces] = useState(true)
  const [hover, setHover] = useState<string | null>(null)

  const qShown = trim === 0 ? nbTrimestres : trim

  const visible = useMemo(
    () =>
      points
        .map((p) => ({ ...p, positions: p.positions.filter((pos) => pos.q <= qShown) }))
        .filter((p) => p.positions.some((pos) => pos.q === qShown)),
    [points, qShown]
  )

  const allX = visible.flatMap((p) => p.positions.filter((pos) => pos.q === qShown).map((pos) => pos.x))
  const allY = visible.flatMap((p) => p.positions.filter((pos) => pos.q === qShown).map((pos) => pos.y))
  const bx = niceBound(allX, 10)
  const by = niceBound(allY, 10)

  const sx = (x: number) => PAD.l + ((Math.max(-bx, Math.min(bx, x)) + bx) / (2 * bx)) * (W - PAD.l - PAD.r)
  const sy = (y: number) => PAD.t + ((by - Math.max(-by, Math.min(by, y))) / (2 * by)) * (H - PAD.t - PAD.b)
  const cx = sx(0)
  const cy = sy(0)

  const maxPoids = Math.max(1, ...visible.filter((p) => !p.reference).map((p) => Math.abs(p.poids)))
  const radius = (p: CrossPoint) => (p.reference ? 7 : 6 + 16 * Math.sqrt(Math.abs(p.poids) / maxPoids))

  const ticksX = [-bx, -bx / 2, 0, bx / 2, bx]
  const ticksY = [-by, -by / 2, 0, by / 2, by]
  const hovered = visible.find((p) => p.key === hover)

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-[#E2DFD8] bg-[#FAF9F7] p-0.5 text-[12px]">
          {Array.from({ length: nbTrimestres }, (_, i) => i + 1).map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => setTrim(q === nbTrimestres ? 0 : q)}
              className={`rounded-md px-2.5 py-1 font-semibold ${qShown === q ? 'bg-[#111820] text-white' : 'text-slate-600 hover:text-slate-900'}`}
            >
              T{q}
            </button>
          ))}
        </div>
        <label className="flex cursor-pointer items-center gap-1.5 text-[12px] text-slate-600">
          <input type="checkbox" checked={traces} onChange={(e) => setTraces(e.target.checked)} className="h-3.5 w-3.5 accent-[#B4761A]" />
          Trajectoire depuis T1
        </label>
        <span className="ml-auto text-[11px] text-slate-400">Taille des bulles = CA N à date</span>
      </div>

      {nbTrimestres === 0 ? (
        <div className="rounded-xl border border-dashed border-[#D8D3C8] p-10 text-center text-sm text-slate-500">
          Aucun trimestre clos sur l’année sélectionnée.
        </div>
      ) : (
        <div className="relative">
          <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full select-none" role="img" aria-label="Croix de positionnement vs N-1">
            {/* quadrants */}
            <rect x={cx} y={PAD.t} width={W - PAD.r - cx} height={cy - PAD.t} fill="#E5F2E8" opacity={0.55} />
            <rect x={cx} y={cy} width={W - PAD.r - cx} height={H - PAD.b - cy} fill="#FBF1DC" opacity={0.55} />
            <rect x={PAD.l} y={PAD.t} width={cx - PAD.l} height={cy - PAD.t} fill="#E4EEF7" opacity={0.55} />
            <rect x={PAD.l} y={cy} width={cx - PAD.l} height={H - PAD.b - cy} fill="#FBE6E3" opacity={0.55} />

            {/* grille */}
            {ticksX.map((t) => (
              <g key={`gx${t}`}>
                <line x1={sx(t)} x2={sx(t)} y1={PAD.t} y2={H - PAD.b} stroke="#E2DFD8" strokeDasharray={t === 0 ? undefined : '3 4'} />
                <text x={sx(t)} y={H - PAD.b + 14} textAnchor="middle" fontSize={10} fill="#8A8578">
                  {t > 0 ? '+' : ''}
                  {t} %
                </text>
              </g>
            ))}
            {ticksY.map((t) => (
              <g key={`gy${t}`}>
                <line x1={PAD.l} x2={W - PAD.r} y1={sy(t)} y2={sy(t)} stroke="#E2DFD8" strokeDasharray={t === 0 ? undefined : '3 4'} />
                <text x={PAD.l - 6} y={sy(t) + 3} textAnchor="end" fontSize={10} fill="#8A8578">
                  {t > 0 ? '+' : ''}
                  {t}
                </text>
              </g>
            ))}

            {/* axes */}
            <line x1={PAD.l} x2={W - PAD.r} y1={cy} y2={cy} stroke="#111820" strokeWidth={1.4} />
            <line x1={cx} x2={cx} y1={PAD.t} y2={H - PAD.b} stroke="#111820" strokeWidth={1.4} />
            <text x={cx} y={PAD.t - 10} textAnchor="middle" fontSize={12} fontWeight={700} fill="#1F6B3A">Ça va mieux</text>
            <text x={cx} y={H - 8} textAnchor="middle" fontSize={12} fontWeight={700} fill="#A32C2C">Ça se dégrade</text>
            <text x={PAD.l + 4} y={cy - 6} fontSize={12} fontWeight={700} fill="#A32C2C">Ça va pas</text>
            <text x={W - PAD.r - 4} y={cy - 6} textAnchor="end" fontSize={12} fontWeight={700} fill="#1F6B3A">Ça va</text>

            {/* trajectoires */}
            {traces &&
              visible.map((p) =>
                p.positions.length > 1 ? (
                  <polyline
                    key={`t${p.key}`}
                    points={p.positions.map((pos) => `${sx(pos.x)},${sy(pos.y)}`).join(' ')}
                    fill="none"
                    stroke={p.reference ? '#B4761A' : hover === p.key ? '#111820' : '#7A8BA3'}
                    strokeWidth={hover === p.key ? 2 : 1.2}
                    strokeDasharray={p.reference ? '4 3' : undefined}
                    opacity={hover && hover !== p.key ? 0.25 : 0.8}
                  />
                ) : null
              )}
            {traces &&
              visible.map((p) =>
                p.positions
                  .filter((pos) => pos.q < qShown)
                  .map((pos) => (
                    <g key={`d${p.key}${pos.q}`} opacity={hover && hover !== p.key ? 0.25 : 1}>
                      <circle cx={sx(pos.x)} cy={sy(pos.y)} r={3} fill="#fff" stroke={p.reference ? '#B4761A' : '#7A8BA3'} />
                      {hover === p.key && (
                        <text x={sx(pos.x) + 5} y={sy(pos.y) - 4} fontSize={9} fill="#475569">
                          T{pos.q}
                        </text>
                      )}
                    </g>
                  ))
              )}

            {/* bulles */}
            {[...visible]
              .sort((a, b) => Math.abs(b.poids) - Math.abs(a.poids))
              .map((p) => {
                const pos = p.positions.find((x) => x.q === qShown)
                if (!pos) return null
                const r = radius(p)
                const faded = hover && hover !== p.key
                return (
                  <g
                    key={`b${p.key}`}
                    onMouseEnter={() => setHover(p.key)}
                    onMouseLeave={() => setHover(null)}
                    onClick={() => !p.reference && onSelect?.(p.key)}
                    style={{ cursor: p.reference ? 'default' : 'pointer' }}
                    opacity={faded ? 0.3 : 1}
                  >
                    {p.reference ? (
                      <rect x={sx(pos.x) - r} y={sy(pos.y) - r} width={2 * r} height={2 * r} transform={`rotate(45 ${sx(pos.x)} ${sy(pos.y)})`} fill="#B4761A" stroke="#fff" strokeWidth={1.5} />
                    ) : (
                      <circle cx={sx(pos.x)} cy={sy(pos.y)} r={r} fill="#6F94D6" fillOpacity={0.75} stroke="#2F5DA8" strokeWidth={1.2} />
                    )}
                    <text
                      x={sx(pos.x) > W - 130 ? sx(pos.x) - r - 4 : sx(pos.x) + r + 4}
                      y={sy(pos.y) + 4}
                      textAnchor={sx(pos.x) > W - 130 ? 'end' : 'start'}
                      fontSize={11}
                      fontWeight={p.reference ? 700 : 600}
                      fill={p.reference ? '#8A5A11' : '#334155'}
                      style={{ paintOrder: 'stroke', stroke: '#fff', strokeWidth: 3 }}
                    >
                      {p.label}
                    </text>
                  </g>
                )
              })}
          </svg>

          {hovered && (
            <div className="pointer-events-none absolute right-2 top-2 w-[230px] rounded-xl border border-[#E2DFD8] bg-white/95 p-3 text-[12px] shadow-lg">
              <div className="mb-1 font-bold text-slate-900">{hovered.label}</div>
              {!hovered.reference && <div className="mb-1 text-slate-500">CA N à date {fmtK(hovered.poids)}</div>}
              <table className="w-full">
                <thead>
                  <tr className="text-[10px] uppercase text-slate-400">
                    <th className="text-left font-semibold">Trim.</th>
                    <th className="text-right font-semibold">Cumul vs N-1</th>
                    <th className="text-right font-semibold">Tendance</th>
                  </tr>
                </thead>
                <tbody>
                  {hovered.positions.map((pos) => (
                    <tr key={pos.q}>
                      <td>T{pos.q}</td>
                      <td className="text-right font-semibold">{fmtPct(pos.x)}</td>
                      <td className="text-right">{fmtPts(pos.y)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
