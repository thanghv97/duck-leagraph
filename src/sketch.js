import rough from 'roughjs'

const gen = rough.generator()

// Stable seed per id, so a shape keeps the same wobble every time it is redrawn.
export const seedOf = (id) => [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 2 ** 31

const toPaths = (drawable) => gen.toPaths(drawable)

// `band` is the height of the title band. When the box is taller than that, the band is the only tinted part:
// the description area below it stays empty inside the outline.
export function boxPaths({ id, w, h, band, color, filled }) {
  const base = { seed: seedOf(id), roughness: 1.4, stroke: color, strokeWidth: 2 }
  const fill = filled ? color : `${color}26`
  if (h <= band) return toPaths(gen.rectangle(2, 2, w - 4, h - 4, { ...base, fill, fillStyle: 'solid' }))
  return [
    ...toPaths(gen.rectangle(2, 2, w - 4, band - 4, { ...base, stroke: 'none', fill, fillStyle: 'solid' })),
    ...toPaths(gen.rectangle(2, 2, w - 4, h - 4, base)),
    ...toPaths(gen.line(2, band - 2, w - 2, band - 2, { ...base, seed: seedOf(`${id}-`), roughness: 1 })),
  ]
}

// Point where the line from the centre of `rect` towards `to` leaves the rectangle.
function exitPoint(rect, to) {
  const cx = rect.x + rect.w / 2
  const cy = rect.y + rect.h / 2
  const dx = to.x - cx
  const dy = to.y - cy
  if (!dx && !dy) return { x: cx, y: cy }
  const s = Math.min(rect.w / 2 / (Math.abs(dx) || 1e-9), rect.h / 2 / (Math.abs(dy) || 1e-9))
  return { x: cx + dx * s, y: cy + dy * s }
}

const centre = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 })

// End points and bowed midpoint of the connector between two boxes.
function geometry(from, to) {
  const a = exitPoint(from, centre(to))
  const b = exitPoint(to, centre(from))
  const len = Math.hypot(b.x - a.x, b.y - a.y)
  const bow = Math.min(18, len * 0.08)
  const nx = len ? -(b.y - a.y) / len : 0
  const ny = len ? (b.x - a.x) / len : 0
  return { a, b, mid: [(a.x + b.x) / 2 + nx * bow, (a.y + b.y) / 2 + ny * bow] }
}

// Where a label sits on the connector.
export const linkMid = (from, to) => {
  const { mid } = geometry(from, to)
  return { x: mid[0], y: mid[1] }
}

// A hand-drawn connector that attaches wherever the two boxes face each other.
// `dir` says where arrowheads go: 'none', 'a2b' (head at `to`), 'b2a' (head at `from`) or 'both'.
export function connectorPaths({ id, from, to, color, dir = 'none', width = 2.4 }) {
  const { a, b, mid } = geometry(from, to)
  const opts = { seed: seedOf(id), roughness: 0.9, stroke: color, strokeWidth: width }
  const paths = toPaths(gen.curve([[a.x, a.y], mid, [b.x, b.y]], opts))

  // Arrowhead at `tip`, pointing along the stretch of the curve that comes from `back`.
  const head = (tip, back, seed) => {
    const dx = tip.x - back[0]
    const dy = tip.y - back[1]
    const d = Math.hypot(dx, dy) || 1
    const wing = (turn) => {
      const cos = Math.cos(turn)
      const sin = Math.sin(turn)
      const ux = -dx / d
      const uy = -dy / d
      return [tip.x + (ux * cos - uy * sin) * 15, tip.y + (ux * sin + uy * cos) * 15]
    }
    const turn = Math.PI / 7
    return toPaths(gen.linearPath([wing(turn), [tip.x, tip.y], wing(-turn)], { ...opts, seed }))
  }
  if (dir === 'a2b' || dir === 'both') paths.push(...head(b, mid, seedOf(`${id}>`)))
  if (dir === 'b2a' || dir === 'both') paths.push(...head(a, mid, seedOf(`${id}<`)))
  return paths
}
