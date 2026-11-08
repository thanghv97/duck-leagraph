import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { ReactFlow, ReactFlowProvider, Controls, MiniMap, Handle, Position, ConnectionMode, EdgeLabelRenderer, useReactFlow, useInternalNode, useConnection } from '@xyflow/react'
import { NODE_H, nodeWidth, nodeHeight, descLines, resetWrapCache, upgradeMap } from './layout.js'
import { api } from './api.js'
import { boxPaths, connectorPaths, linkMid, routeAround } from './sketch.js'

const MapCtx = createContext(null)

const SELECT_COLOR = '#6965db'
const LINK_COLOR = '#3c4656'
const GHOST_COLOR = '#8a94a3'
const MAX_DEPTH = 6

const rectOf = (n) => ({
  x: n.internals.positionAbsolute.x,
  y: n.internals.positionAbsolute.y,
  w: n.measured?.width ?? n.width,
  h: n.measured?.height ?? n.height,
})

// Connector that re-attaches to whichever sides of the two boxes face each other, so it follows drags.
function SketchEdge({ id, source, target, selected, data }) {
  const ctx = useContext(MapCtx)
  const [draft, setDraft] = useState('')
  const from = useInternalNode(source)
  const to = useInternalNode(target)
  const route = ctx.routes[id]
  if (!from || !to) return null
  const a = rectOf(from)
  const b = rectOf(to)
  const { linkId, label, editing, dir, ghost } = data
  const paths = connectorPaths({ id, from: a, to: b, color: ghost ? GHOST_COLOR : selected ? SELECT_COLOR : LINK_COLOR, width: ghost ? 1.8 : selected ? 3.2 : 2.4, dir, route })
  const { x, y } = linkMid(a, b, route)
  return (
    <>
    <g className="sketch-edge">
      {/* Wide invisible stroke so a thin hand-drawn line is easy to click. */}
      {!ghost && paths.map((p, i) => (
        <path key={`hit-${i}`} d={p.d} className="edge-hit" fill="none" />
      ))}
      {paths.map((p, i) => (
        <path key={i} d={p.d} stroke={p.stroke} strokeWidth={p.strokeWidth} fill="none" strokeLinecap="round" strokeDasharray={ghost ? '6 6' : undefined} />
      ))}
    </g>
    {(label || editing) && (
      <EdgeLabelRenderer>
        <div
          className={`link-label nodrag nopan ${selected ? 'is-selected' : ''} ${ghost ? 'is-ghost' : ''}`}
          style={{ transform: `translate(-50%, -50%) translate(${x}px, ${y}px)` }}
          onClick={ghost ? undefined : () => ctx.selectLink(linkId)}
          onDoubleClick={ghost ? undefined : (e) => { e.stopPropagation(); ctx.editLink(linkId) }}
        >
          {editing ? (
            <input
              autoFocus
              value={draft}
              size={Math.max(6, draft.length + 1)}
              onFocus={(e) => { setDraft(label || ''); e.target.select() }}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => ctx.commitLabel(linkId, draft)}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter') ctx.commitLabel(linkId, draft)
                if (e.key === 'Escape') ctx.commitLabel(linkId, label || '')
              }}
            />
          ) : label}
        </div>
      </EdgeLabelRenderer>
    )}
    </>
  )
}

function TopicNode({ data }) {
  const ctx = useContext(MapCtx)
  const { id, title, color, w, h, lines, filled, sub, note, selected, single, editing, center, bookmark } = data
  const [draft, setDraft] = useState(title)
  const connecting = useConnection((c) => c.inProgress)
  const box = useMemo(() => boxPaths({ id, w, h, band: NODE_H, color, filled }), [id, w, h, color, filled])

  useEffect(() => { if (editing) setDraft(title) }, [editing, title])

  return (
    <div
      className={`tnode ${filled ? 'is-filled' : ''} ${selected ? 'is-selected' : ''}`}
      style={{ '--c': color, height: h }}
      onDoubleClick={(e) => { e.stopPropagation(); ctx.edit(id) }}
    >
      <svg className="box" width={w} height={h} aria-hidden="true">
        {box.map((p, i) => (
          <path key={i} d={p.d} stroke={p.stroke === 'none' ? 'none' : p.stroke} strokeWidth={p.strokeWidth} fill={p.fill || 'none'} strokeLinecap="round" />
        ))}
      </svg>
      {/* Drag from a dot to another box to draw a link. The invisible body handle is the drop target and only
          captures the pointer while a link is being drawn, so it never blocks dragging the box itself. */}
      <Handle id="body" type="target" position={Position.Left} className="body-handle" style={{ pointerEvents: connecting ? 'all' : 'none' }} />
      <Handle id="l" type="source" position={Position.Left} className="side-handle" />
      <Handle id="t" type="source" position={Position.Top} className="side-handle" />
      <Handle id="b" type="source" position={Position.Bottom} className="side-handle" />
      <Handle id="r" type="source" position={Position.Right} className="side-handle" />
      <div className="head">
      {editing ? (
        <input
          className="title-input nodrag nopan"
          autoFocus
          value={draft}
          onFocus={(e) => e.target.select()}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => ctx.commit(id, draft)}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') ctx.commit(id, draft)
            if (e.key === 'Escape') ctx.commit(id, title)
          }}
        />
      ) : (
        <span className="title">{title}</span>
      )}
      {note && <span className="note-dot" title="Has notes" />}
      {bookmark && <span className="bookmark-flag" title="Bookmarked" />}
      {sub && (
        <button className="sub-badge nodrag nopan" title="Open this box's map" onClick={(e) => { e.stopPropagation(); ctx.openMap(id) }}>
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="3" width="12" height="10" rx="1.5" />
            <path d="M5 7h6M5 10h3" />
          </svg>
        </button>
      )}
      </div>
      {lines.length > 0 && (
        <div className="desc">
          {lines.map((l, i) => <div key={i}>{l || ' '}</div>)}
        </div>
      )}

      {selected && single && !editing && (
        <div className="node-tools nodrag nopan" onDoubleClick={(e) => e.stopPropagation()}>
          <button onClick={() => ctx.addLinked(id)}>Add linked box</button>
          <button onClick={() => ctx.openMap(id)}>{sub ? 'Open map' : 'Open as map'}</button>
          {(!center || ctx.inSubMap) && <button className="danger" onClick={() => ctx.remove(id)}>{center ? 'Delete map' : 'Delete'}</button>}
        </div>
      )}
    </div>
  )
}

// Read-only copy of a box that is linked to the centre of a sub-map, drawn like in that sub-map around the box that owns it.
function GhostNode({ data }) {
  const { id, title, color, w, h, lines, filled, note, sub, bookmark } = data
  const connecting = useConnection((c) => c.inProgress)
  const box = useMemo(() => boxPaths({ id, w, h, band: NODE_H, color, filled }), [id, w, h, color, filled])
  return (
    <div className={`tnode ghost ${filled ? 'is-filled' : ''}`} style={{ '--c': color, height: h }} title={`In the map of “${data.owner}”`}>
      <svg className="box" width={w} height={h} aria-hidden="true">
        {box.map((p, i) => (
          <path key={i} d={p.d} stroke={p.stroke === 'none' ? 'none' : p.stroke} strokeWidth={p.strokeWidth} fill={p.fill || 'none'} strokeLinecap="round" />
        ))}
      </svg>
      <Handle id="body" type="target" position={Position.Left} className="body-handle" style={{ pointerEvents: connecting ? 'all' : 'none' }} />
      <Handle id="l" type="source" position={Position.Left} className="side-handle" />
      <Handle id="t" type="source" position={Position.Top} className="side-handle" />
      <Handle id="b" type="source" position={Position.Bottom} className="side-handle" />
      <Handle id="r" type="source" position={Position.Right} className="side-handle" />
      <div className="head">
        <span className="title">{title}</span>
        {note && <span className="note-dot" />}
        {bookmark && <span className="bookmark-flag" />}
        {sub && (
          <span className="sub-badge">
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="3" width="12" height="10" rx="1.5" />
              <path d="M5 7h6M5 10h3" />
            </svg>
          </span>
        )}
      </div>
      {lines.length > 0 && (
        <div className="desc">
          {lines.map((l, i) => <div key={i}>{l || ' '}</div>)}
        </div>
      )}
    </div>
  )
}

const nodeTypes = { topic: TopicNode, ghost: GhostNode }
const edgeTypes = { sketch: SketchEdge }

function Canvas({ topic, map, mapId, chain, goToLevel, selection, setSelection, selectedLink, setSelectedLink, editingId, setEditingId, editingLink, setEditingLink, status, ops }) {
  const { fitView, screenToFlowPosition, setCenter, getZoom } = useReactFlow()
  const canvasRef = useRef(null)
  const [viewOpen, setViewOpen] = useState(false)
  const viewRef = useRef(null)
  const bookmarks = map.nodes.filter((n) => n.bookmark)
  // Descriptions are wrapped by measuring text, so measure again once the hand-written font has loaded.
  const [fontTick, setFontTick] = useState(0)
  useEffect(() => {
    document.fonts.ready.then(() => { resetWrapCache(); setFontTick((t) => t + 1) })
  }, [])

  useEffect(() => {
    if (!viewOpen) return
    const close = (e) => {
      if (e.type === 'keydown' ? e.key === 'Escape' : !viewRef.current?.contains(e.target)) setViewOpen(false)
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', close)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', close)
    }
  }, [viewOpen])

  // Put a box in the middle of the canvas, keeping the current zoom unless it is too far out to read.
  const focusNode = (id) => {
    const n = map.nodes.find((x) => x.id === id)
    if (!n) return
    setViewOpen(false)
    setCenter(n.x + nodeWidth(n) / 2, n.y + nodeHeight(n) / 2, { zoom: Math.max(getZoom(), 0.8), duration: 300 })
  }

  // A box that owns a sub-map is surrounded by the sub-map's boxes that touch its centre (or are linked to from here),
  // and the sub-map in turn shows the outer boxes around its centre. Links between the two levels live in the outer map
  // as `{ a: outer box, b: inner box, via: owner box }`.
  const parentId = chain.length > 1 ? chain[chain.length - 2].id : null
  const subKey = map.nodes.filter((n) => n.sub).map((n) => n.id).join(',')
  const [subs, setSubs] = useState({})
  // Connector routes chosen by "Rearrange links": waypoints per edge, kept per map in this browser (not in the data).
  const routeKey = `routes:${topic}:${mapId}`
  const [routes, setRoutes] = useState(() => {
    try { return JSON.parse(localStorage.getItem(routeKey)) || {} } catch { return {} }
  })
  const saveRoutes = (next) => {
    setRoutes(next)
    if (Object.keys(next).length) localStorage.setItem(routeKey, JSON.stringify(next))
    else localStorage.removeItem(routeKey)
  }
  // How many links away from the centre box the other level is previewed (0 turns it off).
  const [depth, setDepthState] = useState(() => {
    const v = Number(localStorage.getItem('crossDepth'))
    return Number.isInteger(v) && v >= 0 && v <= MAX_DEPTH ? v : 1
  })
  const setDepth = (v) => {
    const d = Math.min(MAX_DEPTH, Math.max(0, v))
    localStorage.setItem('crossDepth', String(d))
    setDepthState(d)
  }
  const [parent, setParent] = useState(null)
  const loadParent = useCallback(() => {
    if (!parentId) { setParent(null); return Promise.resolve() }
    return api.getMap(topic, parentId).then((raw) => setParent(upgradeMap(raw, ''))).catch(() => setParent(null))
  }, [topic, parentId])
  useEffect(() => {
    let live = true
    const ids = subKey ? subKey.split(',') : []
    Promise.all(ids.map((id) => api.getMap(topic, id).then((raw) => [id, upgradeMap(raw, '')]).catch(() => null))).then((rows) => {
      if (live) setSubs(Object.fromEntries(rows.filter(Boolean)))
    })
    return () => { live = false }
  }, [subKey, topic])
  useEffect(() => { loadParent() }, [loadParent])

  const ghosts = useMemo(() => {
    const flipDir = (dir) => ({ a2b: 'b2a', b2a: 'a2b' }[dir] || dir || 'none')
    const nodes = []
    const edges = []
    const have = new Set()
    const addGhost = (id, n, centre, anchor, owner) => {
      if (have.has(id)) return
      have.add(id)
      const w = nodeWidth(n)
      const h = nodeHeight(n)
      nodes.push({
        id,
        type: 'ghost',
        position: { x: anchor.x + (n.x + w / 2 - centre.x) - w / 2, y: anchor.y + (n.y + h / 2 - centre.y) - h / 2 },
        width: w,
        height: h,
        measured: { width: w, height: h },
        handles: [
          { id: 'body', type: 'target', position: Position.Left, x: 0, y: 0, width: w, height: h },
          { id: 'l', type: 'source', position: Position.Left, x: 0, y: h / 2, width: 1, height: 1 },
          { id: 'r', type: 'source', position: Position.Right, x: w, y: h / 2, width: 1, height: 1 },
          { id: 't', type: 'source', position: Position.Top, x: w / 2, y: 0, width: 1, height: 1 },
          { id: 'b', type: 'source', position: Position.Bottom, x: w / 2, y: h, width: 1, height: 1 },
        ],
        draggable: false,
        selectable: false,
        focusable: false,
        data: { id, title: n.title, color: n.color || '#1b2330', w, h, lines: descLines(n), filled: !!n.filled, note: !!n.note, sub: !!n.sub, bookmark: !!n.bookmark, owner },
      })
    }
    const centreOf = (n) => ({ x: n.x + nodeWidth(n) / 2, y: n.y + nodeHeight(n) / 2 })
    const edge = (id, source, target, link, flip, extra = {}) => ({
      id, source, target, type: 'sketch', selectable: !!extra.linkId, focusable: false,
      data: { ghost: !extra.linkId, label: link.label || '', dir: flip ? flipDir(link.dir) : link.dir || 'none', ...extra },
    })

    // Boxes within `depth` links of `start`, and every link that stays inside that set.
    const reach = (m, start, skip) => {
      const seen = new Map([[start, 0]])
      let frontier = [start]
      for (let d = 1; d <= depth; d++) {
        const next = []
        for (const l of m.links) {
          if (skip(l)) continue
          for (const [x, y] of [[l.a, l.b], [l.b, l.a]]) {
            if (frontier.includes(x) && !seen.has(y) && m.nodes.some((n) => n.id === y)) { seen.set(y, d); next.push(y) }
          }
        }
        frontier = next
      }
      return { seen, links: m.links.filter((l) => !skip(l) && seen.has(l.a) && seen.has(l.b)) }
    }

    // Outer view: the boxes inside each sub-map.
    for (const owner of map.nodes) {
      const sm = owner.sub && subs[owner.id]
      const c = sm && sm.nodes.find((n) => n.id === sm.center)
      if (!c) continue
      const cc = centreOf(c)
      const anchor = centreOf(owner)
      const ghostId = (id) => `ghost:${owner.id}:${id}`
      const nid = (id) => (id === c.id ? owner.id : ghostId(id))
      const { seen, links } = reach(sm, c.id, () => false)
      seen.forEach((_, id) => { if (id !== c.id) addGhost(ghostId(id), sm.nodes.find((n) => n.id === id), cc, anchor, owner.title) })
      links.forEach((l) => edges.push(edge(`${owner.id}:${l.id}-edge`, nid(l.a), nid(l.b), l, false)))
      map.links.filter((l) => l.via === owner.id).forEach((l) => {
        const o = sm.nodes.find((n) => n.id === l.b)
        if (!o || !map.nodes.some((n) => n.id === l.a)) return
        addGhost(ghostId(o.id), o, cc, anchor, owner.title)
        edges.push(edge(`link-${l.id}`, l.a, ghostId(o.id), l, false, { linkId: l.id, editing: false }))
      })
    }

    // Sub-map view: the outer boxes around the owner box.
    const owner = parent && parent.nodes.find((n) => n.id === mapId)
    const c = map.nodes.find((n) => n.id === map.center)
    if (owner && c) {
      const oc = centreOf(owner)
      const anchor = centreOf(c)
      const ghostId = (id) => `up:${id}`
      const nid = (id) => (id === owner.id ? c.id : ghostId(id))
      const { seen, links } = reach(parent, owner.id, (l) => !!l.via)
      seen.forEach((_, id) => { if (id !== owner.id) addGhost(ghostId(id), parent.nodes.find((n) => n.id === id), oc, anchor, 'outer map') })
      links.forEach((l) => edges.push(edge(`up-${l.id}`, nid(l.a), nid(l.b), l, false)))
      parent.links.filter((l) => l.via === owner.id).forEach((l) => {
        const o = parent.nodes.find((n) => n.id === l.a)
        if (!o || !map.nodes.some((n) => n.id === l.b)) return
        addGhost(ghostId(o.id), o, oc, anchor, 'outer map')
        edges.push(edge(`up-${l.id}`, l.b, ghostId(o.id), l, true))
      })
    }
    return { nodes, edges }
  }, [map.nodes, map.links, map.center, subs, parent, mapId, depth])

  const nodes = useMemo(() => [...map.nodes.map((n) => {
    const w = nodeWidth(n)
    const lines = descLines(n)
    const h = nodeHeight(n)
    const picked = selection.includes(n.id)
    return {
      id: n.id,
      type: 'topic',
      position: { x: n.x, y: n.y },
      width: w,
      height: h,
      // Declared up front: without these, React Flow drops the handle bounds whenever `nodes` changes and
      // treats every node as "inside" a selection box.
      measured: { width: w, height: h },
      handles: [
        { id: 'body', type: 'target', position: Position.Left, x: 0, y: 0, width: w, height: h },
        { id: 'l', type: 'source', position: Position.Left, x: 0, y: h / 2, width: 1, height: 1 },
        { id: 'r', type: 'source', position: Position.Right, x: w, y: h / 2, width: 1, height: 1 },
        { id: 't', type: 'source', position: Position.Top, x: w / 2, y: 0, width: 1, height: 1 },
        { id: 'b', type: 'source', position: Position.Bottom, x: w / 2, y: h, width: 1, height: 1 },
      ],
      selected: picked,
      data: {
        id: n.id,
        title: n.title,
        color: n.color || '#1b2330',
        w,
        h,
        lines,
        filled: !!n.filled,
        sub: !!n.sub,
        note: !!n.note,
        selected: picked,
        single: selection.length === 1,
        editing: n.id === editingId,
        center: n.id === map.center,
        bookmark: !!n.bookmark,
      },
    }
  }), ...ghosts.nodes], [map.nodes, map.center, selection, editingId, fontTick, ghosts])

  const edges = useMemo(() => [...map.links.filter((l) => !l.via).map((l) => ({
    id: `link-${l.id}`,
    source: l.a,
    target: l.b,
    type: 'sketch',
    selected: l.id === selectedLink,
    data: { linkId: l.id, label: l.label || '', editing: l.id === editingLink, dir: l.dir || 'none' },
  })), ...ghosts.edges], [map.links, selectedLink, editingLink, ghosts])

  // One-off: route every connector around the boxes as they are now. Later moves do not touch the routes.
  const rearrangeLinks = () => {
    setViewOpen(false)
    const rects = new Map(nodes.map((n) => [n.id, { x: n.position.x, y: n.position.y, w: n.width, h: n.height }]))
    const next = {}
    edges.forEach((e) => {
      const from = rects.get(e.source)
      const to = rects.get(e.target)
      if (!from || !to) return
      const others = [...rects].filter(([id]) => id !== e.source && id !== e.target).map(([, r]) => r)
      const route = routeAround(from, to, others)
      if (route) next[e.id] = route
    })
    saveRoutes(next)
  }

  // The boxes of the other level arrive after the map, so fit the view once more when they have settled.
  const { fitView: refit } = useReactFlow()
  const refitted = useRef(false)
  useEffect(() => {
    if (refitted.current) return
    const t = setTimeout(() => { refitted.current = true; refit({ padding: 0.25, maxZoom: 1.1, duration: 200 }) }, 350)
    return () => clearTimeout(t)
  }, [ghosts, refit])

  // A map that was rearranged before is rearranged again when it opens, once the boxes of the other level have
  // loaded (they arrive a moment after the map itself).
  const rearrangeRef = useRef(rearrangeLinks)
  rearrangeRef.current = rearrangeLinks
  const autoRearrange = useRef(localStorage.getItem(routeKey) !== null)
  useEffect(() => {
    if (!autoRearrange.current) return
    const t = setTimeout(() => { autoRearrange.current = false; rearrangeRef.current() }, 300)
    return () => clearTimeout(t)
  }, [ghosts, map.nodes])

  // Dragging moves only the selected boxes (React Flow reports one change per moved box).
  const onNodesChange = useCallback((changes) => {
    const picks = changes.filter((c) => c.type === 'select')
    if (picks.some((c) => c.selected)) setSelectedLink(null)
    if (picks.length) {
      setSelection((prev) => {
        const next = new Set(prev)
        picks.forEach((c) => (c.selected ? next.add(c.id) : next.delete(c.id)))
        return [...next]
      })
    }
    const moves = changes.filter((c) => c.type === 'position' && c.position)
    if (!moves.length) return
    ops.updateMap((m) => {
      const moved = new Map(moves.map((c) => [c.id, c.position]))
      let changed = false
      const next = m.nodes.map((n) => {
        const pos = moved.get(n.id)
        if (!pos) return n
        const x = Math.round(pos.x)
        const y = Math.round(pos.y)
        if (x === n.x && y === n.y) return n
        changed = true
        return { ...n, x, y }
      })
      return changed ? { ...m, nodes: next } : m
    })
  }, [ops, setSelection, setSelectedLink])

  // Double-click on empty canvas drops a new box there.
  const onCanvasDoubleClick = (e) => {
    if (!e.target.classList.contains('react-flow__pane')) return
    const p = screenToFlowPosition({ x: e.clientX, y: e.clientY })
    ops.addNode({ x: p.x - 70, y: p.y - NODE_H / 2 })
  }

  const addAtCentre = () => {
    const r = canvasRef.current.getBoundingClientRect()
    const p = screenToFlowPosition({ x: r.left + r.width / 2, y: r.top + r.height / 2 })
    ops.addNode({ x: p.x - 70, y: p.y - NODE_H / 2 })
  }

  const isGhost = (id) => id.startsWith('ghost:') || id.startsWith('up:')
  const titleOf = (id) => ghosts.nodes.find((n) => n.id === id)?.data.title
  // Dropping a link on a box of the other level stores it in the outer map.
  const onConnect = (c) => {
    const ghostId = isGhost(c.source) ? c.source : isGhost(c.target) ? c.target : null
    if (!ghostId) return ops.addLink(c.source, c.target)
    const real = ghostId === c.source ? c.target : c.source
    if (ghostId.startsWith('ghost:')) {
      const [, via, inner] = ghostId.split(':')
      if (real === via) return
      ops.addCrossLink(mapId, { outer: real, inner, via, title: titleOf(ghostId) })
    } else {
      ops.addCrossLink(parentId, { outer: ghostId.slice(3), inner: real, via: mapId, title: map.nodes.find((n) => n.id === real)?.title }).then(loadParent)
    }
  }

  const ctx = useMemo(() => ({
    edit: setEditingId,
    commit: ops.commitTitle,
    addLinked: ops.addLinkedNode,
    remove: (id) => ops.removeNodes([id]),
    openMap: ops.openSubmap,
    selectLink: (id) => { setSelectedLink(id); setSelection([]) },
    editLink: (id) => { setSelectedLink(id); setSelection([]); setEditingLink(id) },
    commitLabel: ops.commitLabel,
    routes,
    inSubMap: mapId !== 'root',
  }), [routes, mapId, ops, setEditingId, setSelectedLink, setSelection, setEditingLink])

  return (
    <MapCtx.Provider value={ctx}>
      <div className="canvas" ref={canvasRef} onDoubleClick={onCanvasDoubleClick}>
        <div className="topbar">
          <nav className="crumbs" aria-label="Map levels">
            <span className="topic-path">{topic.replace(/\//g, ' › ')}</span>
            {chain.map((c, i) => (
              <button key={c.id} disabled={i === chain.length - 1} onClick={() => goToLevel(i)}>{c.title}</button>
            ))}
          </nav>
          <div className="tools">
            <span className={`save ${status}`}>{status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved' : ''}</span>
            <button onClick={addAtCentre}>Add box</button>
            <div className="view-menu" ref={viewRef}>
              <button aria-haspopup="menu" aria-expanded={viewOpen} onClick={() => setViewOpen((o) => !o)}>View ▾</button>
              {viewOpen && (
                <div className="menu" role="menu">
                  <button role="menuitem" onClick={() => (setViewOpen(false), fitView({ padding: 0.25, maxZoom: 1.1, duration: 250 }))}>Fit view</button>
                  <button role="menuitem" onClick={() => focusNode(map.center)}>Center View</button>
                  <button role="menuitem" onClick={rearrangeLinks} title="Bend every link around the boxes as they are now">Rearrange links</button>
                  <div className="menu-sep">Cross view</div>
                  <div className="menu-depth" title="How many links away from the centre box the other level is shown (0 = off)">
                    <span>Boxes deep</span>
                    <button aria-label="Show fewer" disabled={depth <= 0} onClick={() => setDepth(depth - 1)}>−</button>
                    <b>{depth}</b>
                    <button aria-label="Show more" disabled={depth >= MAX_DEPTH} onClick={() => setDepth(depth + 1)}>+</button>
                  </div>
                  <div className="menu-sep">Bookmark View</div>
                  {bookmarks.length === 0 && <p className="menu-none">None yet. Select a box and use the bookmark button in its panel.</p>}
                  {bookmarks.map((n) => (
                    <button key={n.id} role="menuitem" onClick={() => (setSelection([n.id]), focusNode(n.id))}>{n.title}</button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
        {map.nodes.length === 0 && <p className="canvas-hint">Double-click anywhere to add a box.</p>}
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          connectionMode={ConnectionMode.Loose}
          isValidConnection={(c) => c.source !== c.target && !(isGhost(c.source) && isGhost(c.target))}
          onConnect={onConnect}
          connectionLineStyle={{ stroke: SELECT_COLOR, strokeWidth: 2.4, strokeDasharray: '7 5' }}
          onEdgeDoubleClick={(_, e) => ctx.editLink(e.data.linkId)}
          onEdgeClick={(_, e) => { setSelectedLink(e.data.linkId); setSelection([]) }}
          onPaneClick={() => setSelectedLink(null)}
          fitView
          fitViewOptions={{ padding: 0.25, maxZoom: 1.1 }}
          selectionOnDrag
          panOnDrag={[1, 2]}
          multiSelectionKeyCode={['Control', 'Meta', 'Shift']}
          zoomOnDoubleClick={false}
          deleteKeyCode={null}
          minZoom={0.1}
          maxZoom={2.5}
          proOptions={{ hideAttribution: true }}
        >
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable nodeColor={(n) => (n.type === 'ghost' ? 'transparent' : n.data.color)} maskColor="rgba(237,240,236,.7)" />
        </ReactFlow>
      </div>
    </MapCtx.Provider>
  )
}

export default function MapView(props) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  )
}
