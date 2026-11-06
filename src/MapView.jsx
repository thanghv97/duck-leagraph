import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { ReactFlow, ReactFlowProvider, Controls, MiniMap, Handle, Position, ConnectionMode, EdgeLabelRenderer, useReactFlow, useInternalNode, useConnection } from '@xyflow/react'
import { NODE_H, nodeWidth, nodeHeight, descLines, resetWrapCache } from './layout.js'
import { boxPaths, connectorPaths, linkMid } from './sketch.js'

const MapCtx = createContext(null)

const SELECT_COLOR = '#6965db'
const LINK_COLOR = '#3c4656'

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
  if (!from || !to) return null
  const a = rectOf(from)
  const b = rectOf(to)
  const { linkId, label, editing, dir } = data
  const paths = connectorPaths({ id, from: a, to: b, color: selected ? SELECT_COLOR : LINK_COLOR, width: selected ? 3.2 : 2.4, dir })
  const { x, y } = linkMid(a, b)
  return (
    <>
    <g className="sketch-edge">
      {/* Wide invisible stroke so a thin hand-drawn line is easy to click. */}
      {paths.map((p, i) => (
        <path key={`hit-${i}`} d={p.d} className="edge-hit" fill="none" />
      ))}
      {paths.map((p, i) => (
        <path key={i} d={p.d} stroke={p.stroke} strokeWidth={p.strokeWidth} fill="none" strokeLinecap="round" />
      ))}
    </g>
    {(label || editing) && (
      <EdgeLabelRenderer>
        <div
          className={`link-label nodrag nopan ${selected ? 'is-selected' : ''}`}
          style={{ transform: `translate(-50%, -50%) translate(${x}px, ${y}px)` }}
          onClick={() => ctx.selectLink(linkId)}
          onDoubleClick={(e) => { e.stopPropagation(); ctx.editLink(linkId) }}
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
          {!center && <button className="danger" onClick={() => ctx.remove(id)}>Delete</button>}
        </div>
      )}
    </div>
  )
}

const nodeTypes = { topic: TopicNode }
const edgeTypes = { sketch: SketchEdge }

function Canvas({ topic, map, chain, goToLevel, selection, setSelection, selectedLink, setSelectedLink, editingId, setEditingId, editingLink, setEditingLink, status, ops }) {
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

  const nodes = useMemo(() => map.nodes.map((n) => {
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
  }), [map.nodes, map.center, selection, editingId, fontTick])

  const edges = useMemo(() => map.links.map((l) => ({
    id: `link-${l.id}`,
    source: l.a,
    target: l.b,
    type: 'sketch',
    selected: l.id === selectedLink,
    data: { linkId: l.id, label: l.label || '', editing: l.id === editingLink, dir: l.dir || 'none' },
  })), [map.links, selectedLink, editingLink])

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

  const ctx = useMemo(() => ({
    edit: setEditingId,
    commit: ops.commitTitle,
    addLinked: ops.addLinkedNode,
    remove: (id) => ops.removeNodes([id]),
    openMap: ops.openSubmap,
    selectLink: (id) => { setSelectedLink(id); setSelection([]) },
    editLink: (id) => { setSelectedLink(id); setSelection([]); setEditingLink(id) },
    commitLabel: ops.commitLabel,
  }), [ops, setEditingId, setSelectedLink, setSelection, setEditingLink])

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
          isValidConnection={(c) => c.source !== c.target}
          onConnect={(c) => ops.addLink(c.source, c.target)}
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
          <MiniMap pannable zoomable nodeColor={(n) => n.data.color} maskColor="rgba(237,240,236,.7)" />
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
