export const NODE_H = 46

export const PALETTE = ['#c8443f', '#d99a1c', '#0a7d8c', '#2c5d9a', '#7b5ea7', '#3f8f4a', '#d4651f', '#a1396b']
export const INK = '#1b2330'

export const uid = () => Math.random().toString(36).slice(2, 10)

// A box is a title band (NODE_H tall) with an optional description wrapped underneath it.
export const DESC_LINE = 19
const DESC_PAD_TOP = 2
const DESC_PAD_BOTTOM = 10
const DESC_INSET = 16
const DESC_FONT = '15px "Patrick Hand"'

export const nodeWidth = (n) => {
  const w = Math.min(280, Math.max(120, Math.round(n.title.length * 8.6 + 72)))
  return n.desc?.trim() ? Math.max(w, 200) : w
}

let ruler
let wrapCache = new Map()
export const resetWrapCache = () => wrapCache.clear()

// Splits the description into the exact lines that are drawn, so the box height always matches what is shown.
export function descLines(n) {
  const text = n.desc?.trim()
  if (!text) return []
  const room = nodeWidth(n) - DESC_INSET * 2
  const key = `${room}|${text}`
  if (wrapCache.has(key)) return wrapCache.get(key)
  ruler ||= document.createElement('canvas').getContext('2d')
  ruler.font = DESC_FONT
  const fits = (s) => ruler.measureText(s).width <= room
  const lines = []
  for (const para of text.split('\n')) {
    let line = ''
    for (let word of para.split(/\s+/).filter(Boolean)) {
      if (line && fits(`${line} ${word}`)) { line += ` ${word}`; continue }
      if (line) lines.push(line)
      // A single word wider than the box is broken by characters.
      while (!fits(word) && word.length > 1) {
        let i = word.length - 1
        while (i > 1 && !fits(word.slice(0, i))) i--
        lines.push(word.slice(0, i))
        word = word.slice(i)
      }
      line = word
    }
    lines.push(line)
  }
  wrapCache.set(key, lines)
  return lines
}

export const nodeHeight = (n) => {
  const lines = descLines(n).length
  return lines ? NODE_H + DESC_PAD_TOP + lines * DESC_LINE + DESC_PAD_BOTTOM : NODE_H
}

export function newMap(title) {
  const id = uid()
  return { version: 2, center: id, nodes: [{ id, title, x: 0, y: 0, color: INK, filled: true }], links: [] }
}

// Every map has one centre box. Maps saved before that existed get the most plausible one.
function withCenter(map, fallbackTitle, hint) {
  if (!map.nodes.length) return { ...newMap(fallbackTitle), ...(map.parentMap ? { parentMap: map.parentMap } : {}) }
  const has = (id) => map.nodes.some((n) => n.id === id)
  const center = [map.center, hint].find((id) => id && has(id)) || (map.nodes.find((n) => n.filled) || map.nodes[0]).id
  return { ...map, center }
}

// ---- upgrade of maps saved by the old parent/child model (version 1) ----

const H_GAP = 80
const V_GAP = 22

// The old left-to-right tree layout, used once so that upgraded maps keep their look.
function legacyPositions(map) {
  const kids = new Map()
  const byId = new Map(map.nodes.map((n) => [n.id, n]))
  for (const n of map.nodes) {
    if (n.parent) kids.set(n.parent, [...(kids.get(n.parent) || []), n.id])
  }
  const out = new Map()
  let cursor = 0
  const place = (id, x, branch) => {
    const n = byId.get(id)
    const w = nodeWidth(n)
    const children = kids.get(id) || []
    let y
    if (!children.length) {
      y = cursor
      cursor += NODE_H + V_GAP
    } else {
      const ys = children.map((c, i) => place(c, x + w + H_GAP, id === map.rootId ? i : branch))
      y = (ys[0] + ys[ys.length - 1]) / 2
    }
    out.set(id, { x, y, branch })
    return y
  }
  if (byId.has(map.rootId)) place(map.rootId, 0, 0)
  return out
}

function upgradeV1(raw) {
  const pos = legacyPositions(raw)
  const nodes = raw.nodes.map(({ parent, collapsed, off, ...n }) => {
    const p = pos.get(n.id) || { x: 0, y: 0, branch: 0 }
    const isRoot = n.id === raw.rootId
    return {
      ...n,
      x: Math.round(p.x + (off?.[0] || 0)),
      y: Math.round(p.y + (off?.[1] || 0)),
      color: n.color || (isRoot ? INK : PALETTE[p.branch % PALETTE.length]),
      ...(isRoot ? { filled: true } : {}),
    }
  })
  const pairs = []
  const add = (a, b) => {
    if (a !== b && !pairs.some(([x, y]) => (x === a && y === b) || (x === b && y === a))) pairs.push([a, b])
  }
  raw.nodes.forEach((n) => n.parent && add(n.parent, n.id))
  ;(raw.links || []).forEach((l) => add(l.from, l.to))
  return { version: 2, nodes, links: pairs.map(([a, b]) => ({ id: uid(), a, b })) }
}

export function upgradeMap(raw, fallbackTitle) {
  if (!raw) return newMap(fallbackTitle)
  if (raw.version >= 2) return withCenter({ ...raw, links: raw.links || [] }, fallbackTitle)
  return withCenter({ ...upgradeV1(raw), ...(raw.parentMap ? { parentMap: raw.parentMap } : {}) }, fallbackTitle, raw.rootId)
}
