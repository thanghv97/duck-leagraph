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

const inside = (p, r) => p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h
const grow = (r, m) => ({ x: r.x - m, y: r.y - m, w: r.w + 2 * m, h: r.h + 2 * m })

// Does the straight stretch p -> q cross any rectangle?
const segmentHits = (p, q, rects) => {
  for (let i = 0; i <= 30; i++) {
    const t = i / 30
    const pt = { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t }
    if (rects.some((r) => inside(pt, r))) return true
  }
  return false
}

// Does the curve a -> mid -> b (sampled as a quadratic) pass through any of the rectangles?
const curveHits = (a, mid, b, rects) => {
  const cx = 2 * mid[0] - (a.x + b.x) / 2
  const cy = 2 * mid[1] - (a.y + b.y) / 2
  for (let i = 1; i < 30; i++) {
    const t = i / 30
    const u = 1 - t
    const pt = { x: u * u * a.x + 2 * u * t * cx + t * t * b.x, y: u * u * a.y + 2 * u * t * cy + t * t * b.y }
    if (rects.some((r) => inside(pt, r))) return true
  }
  return false
}

const defaultBow = (a, b) => {
  const len = Math.hypot(b.x - a.x, b.y - a.y)
  const nx = len ? -(b.y - a.y) / len : 0
  const ny = len ? (b.x - a.x) / len : 0
  return { len, nx, ny, bow: Math.min(18, len * 0.08) }
}

// Waypoints that carry a connector around the other boxes, or null when the usual gentle curve is already clear.
// Used once, when the user asks to rearrange the links; the result is stored, so moving boxes later changes nothing.
export function routeAround(from, to, boxes) {
  const rects = boxes.map((r) => grow(r, 14))
  const a = exitPoint(from, centre(to))
  const b = exitPoint(to, centre(from))
  const { nx, ny, bow } = defaultBow(a, b)
  const at = (k) => [(a.x + b.x) / 2 + nx * k, (a.y + b.y) / 2 + ny * k]
  if (!curveHits(a, at(bow), b, rects)) return null
  for (let k = 40; k <= 600; k += 30) {
    for (const sign of [1, -1]) {
      if (!curveHits(a, at(sign * k), b, rects)) return [{ x: at(sign * k)[0], y: at(sign * k)[1] }]
    }
  }
  // Shortest way around the corners of the boxes that stand in the way.
  const corners = []
  for (const r of boxes) {
    const g = grow(r, 30)
    for (const p of [{ x: g.x, y: g.y }, { x: g.x + g.w, y: g.y }, { x: g.x, y: g.y + g.h }, { x: g.x + g.w, y: g.y + g.h }]) {
      if (!rects.some((q) => inside(p, q))) corners.push(p)
    }
  }
  const pts = [a, b, ...corners]
  const dist = pts.map(() => Infinity)
  const prev = pts.map(() => -1)
  const done = pts.map(() => false)
  dist[0] = 0
  for (;;) {
    let u = -1
    pts.forEach((_, i) => { if (!done[i] && dist[i] < Infinity && (u < 0 || dist[i] < dist[u])) u = i })
    if (u < 0 || u === 1) break
    done[u] = true
    pts.forEach((p, v) => {
      if (done[v]) return
      const d = dist[u] + Math.hypot(p.x - pts[u].x, p.y - pts[u].y)
      if (d < dist[v] && !segmentHits(pts[u], p, rects)) { dist[v] = d; prev[v] = u }
    })
  }
  if (prev[1] < 0) return null
  const path = []
  for (let i = prev[1]; i > 0; i = prev[i]) path.unshift({ x: Math.round(pts[i].x), y: Math.round(pts[i].y) })
  return path.length ? path : null
}

// End points and inner points of the connector between two boxes. `route` (waypoints chosen by routeAround)
// replaces the usual gentle bow.
function geometry(from, to, route) {
  if (route?.length) {
    const a = exitPoint(from, route[0])
    const b = exitPoint(to, route[route.length - 1])
    const pts = route.map((p) => [p.x, p.y])
    return { a, b, pts, mid: pts[Math.floor((pts.length - 1) / 2)] }
  }
  const a = exitPoint(from, centre(to))
  const b = exitPoint(to, centre(from))
  const { nx, ny, bow } = defaultBow(a, b)
  const mid = [(a.x + b.x) / 2 + nx * bow, (a.y + b.y) / 2 + ny * bow]
  return { a, b, pts: [mid], mid }
}

// Where a label sits on the connector.
export const linkMid = (from, to, route) => {
  const { mid } = geometry(from, to, route)
  return { x: mid[0], y: mid[1] }
}

// A hand-drawn connector that attaches wherever the two boxes face each other.
// `dir` says where arrowheads go: 'none', 'a2b' (head at `to`), 'b2a' (head at `from`) or 'both'.
export function connectorPaths({ id, from, to, color, dir = 'none', width = 2.4, route }) {
  const { a, b, pts, mid } = geometry(from, to, route)
  const opts = { seed: seedOf(id), roughness: 0.9, stroke: color, strokeWidth: width }
  const paths = toPaths(gen.curve([[a.x, a.y], ...pts, [b.x, b.y]], opts))

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
  if (dir === 'a2b' || dir === 'both') paths.push(...head(b, pts[pts.length - 1], seedOf(`${id}>`)))
  if (dir === 'b2a' || dir === 'both') paths.push(...head(a, pts[0], seedOf(`${id}<`)))
  return paths
}
