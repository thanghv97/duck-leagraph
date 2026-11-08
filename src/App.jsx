import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api.js'
import { NODE_H, PALETTE, nodeWidth, uid, upgradeMap } from './layout.js'
import Sidebar from './Sidebar.jsx'
import MapView from './MapView.jsx'
import NotePanel from './NotePanel.jsx'
import LinkPanel from './LinkPanel.jsx'
import { useKeyboardShortcuts } from './tool/keyboard.js'

const lastSegment = (p) => p.split('/').pop()
const rootCrumb = (topic) => [{ id: 'root', title: lastSegment(topic) }]
const pairKey = (a, b) => [a, b].sort().join('|')

export default function App() {
  const [tree, setTree] = useState([])
  // Where we are: a topic, the map inside it ('root' or the id of the node that owns a sub-map), and the way down.
  const [loc, setLoc] = useState(() => {
    const topic = localStorage.getItem('topic') || null
    return { topic, mapId: 'root', chain: topic ? rootCrumb(topic) : [] }
  })
  const { topic, mapId, chain } = loc
  const [map, setMap] = useState(null)
  // Which topic/map `map` really is. While the next one loads, `map` still holds the previous one.
  const [loadedKey, setLoadedKey] = useState(null)
  const [selection, setSelection] = useState([])
  // Single-node actions (notes panel, shortcuts) only apply when exactly one node is selected.
  const selectedId = selection.length === 1 ? selection[0] : null
  const [selectedLink, setSelectedLink] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [editingLink, setEditingLink] = useState(null)
  const [status, setStatus] = useState('idle') // idle | saving | saved
  const [error, setError] = useState(null)

  const mapRef = useRef(null)
  const locRef = useRef(loc)
  locRef.current = loc
  const pending = useRef(null)
  const timer = useRef()
  const selectAfterLoad = useRef(null)

  const fail = useCallback((e) => setError(e.message || String(e)), [])

  const flush = useCallback(async () => {
    clearTimeout(timer.current)
    const p = pending.current
    if (!p) return
    pending.current = null
    try {
      await api.saveMap(p.topic, p.mapId, p.map)
      if (!pending.current) setStatus('saved')
    } catch (e) {
      fail(e)
      setStatus('idle')
    }
  }, [fail])

  const updateMap = useCallback((fn) => {
    const next = fn(mapRef.current)
    if (next === mapRef.current) return
    mapRef.current = next
    setMap(next)
    const { topic: t, mapId: m, chain: c } = locRef.current
    // A sub-map remembers which map it was opened from, so a search hit can rebuild the breadcrumb.
    const saved = m === 'root' ? next : { ...next, parentMap: c[c.length - 2]?.id || 'root' }
    pending.current = { topic: t, mapId: m, map: saved }
    setStatus('saving')
    clearTimeout(timer.current)
    timer.current = setTimeout(flush, 600)
  }, [flush])

  const reloadTree = useCallback(() => api.tree().then(setTree).catch(fail), [fail])
  useEffect(() => { reloadTree() }, [reloadTree])

  // Load the map whenever we move to another topic or map.
  useEffect(() => {
    let live = true
    setSelection([])
    setSelectedLink(null)
    setEditingId(null)
    setEditingLink(null)
    if (!topic) {
      mapRef.current = null
      setMap(null)
      return
    }
    localStorage.setItem('topic', topic)
    api.getMap(topic, mapId).then((raw) => {
      if (!live) return
      const loaded = upgradeMap(raw, locRef.current.chain.at(-1)?.title || lastSegment(topic))
      mapRef.current = loaded
      setMap(loaded)
      setLoadedKey(`${topic}:${mapId}`)
      if (selectAfterLoad.current) {
        setSelection([selectAfterLoad.current])
        selectAfterLoad.current = null
      }
    }).catch((e) => { fail(e); setMap(null) })
    return () => { live = false }
  }, [topic, mapId, fail])

  const openTopic = useCallback(async (path) => {
    await flush()
    setLoc({ topic: path, mapId: 'root', chain: rootCrumb(path) })
  }, [flush])

  // ---- topic (menu) operations ----
  const createTopic = async (parent, name) => {
    const path = parent ? `${parent}/${name}` : name
    try {
      await api.createFolder(path)
      await reloadTree()
      openTopic(path)
    } catch (e) { fail(e) }
  }

  const renameTopic = async (path, name) => {
    const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
    const to = parent ? `${parent}/${name}` : name
    if (to === path) return
    try {
      await flush()
      await api.renameFolder(path, to)
      await reloadTree()
      if (topic === path || topic?.startsWith(`${path}/`)) {
        const next = to + topic.slice(path.length)
        setLoc((l) => ({ ...l, topic: next, chain: [{ ...l.chain[0], title: lastSegment(next) }, ...l.chain.slice(1)] }))
      }
    } catch (e) { fail(e) }
  }

  const deleteTopic = async (path) => {
    try {
      await api.deleteFolder(path)
      await reloadTree()
      if (topic === path || topic?.startsWith(`${path}/`)) {
        pending.current = null
        setLoc({ topic: null, mapId: 'root', chain: [] })
        localStorage.removeItem('topic')
      }
    } catch (e) { fail(e) }
  }

  // ---- node operations ----
  const patchNode = useCallback((id, patch) =>
    updateMap((m) => ({ ...m, nodes: m.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) })), [updateMap])

  const addNode = useCallback((pos, fromId) => {
    const id = uid()
    updateMap((m) => {
      const from = fromId && m.nodes.find((n) => n.id === fromId)
      const node = {
        id,
        title: 'New topic',
        x: Math.round(pos.x),
        y: Math.round(pos.y),
        color: from?.color || PALETTE[m.nodes.length % PALETTE.length],
      }
      return {
        ...m,
        nodes: [...m.nodes, node],
        links: from ? [...m.links, { id: uid(), a: fromId, b: id }] : m.links,
      }
    })
    setSelection([id])
    setSelectedLink(null)
    setEditingId(id)
  }, [updateMap])

  // New box to the right of `fromId`, already linked to it. Each extra link from the same box fans out downwards.
  const addLinkedNode = useCallback((fromId) => {
    const m = mapRef.current
    const from = m.nodes.find((n) => n.id === fromId)
    const used = m.links.filter((l) => l.a === fromId || l.b === fromId).length
    addNode({ x: from.x + nodeWidth(from) + 90, y: from.y + used * (NODE_H + 24) }, fromId)
  }, [addNode])

  // Deleting the centre box of a sub-map deletes the whole sub-map and returns to the box that owned it.
  const deleteCurrentMap = useCallback(async () => {
    if (!window.confirm('Delete this map and everything inside it?')) return
    const { topic: t, mapId: cur, chain: c } = locRef.current
    const parentId = c[c.length - 2]?.id || 'root'
    clearTimeout(timer.current)
    pending.current = null
    try {
      await api.deleteMap(t, cur)
      const parent = upgradeMap(await api.getMap(t, parentId), '')
      await api.saveMap(t, parentId, {
        ...parent,
        nodes: parent.nodes.map((n) => { if (n.id !== cur) return n; const { sub: _sub, ...rest } = n; return rest }),
        links: parent.links.filter((l) => l.via !== cur),
      })
      setStatus('idle')
      setLoc((l) => ({ ...l, mapId: parentId, chain: l.chain.slice(0, -1) }))
    } catch (e) { fail(e) }
  }, [fail])

  const removeNodes = useCallback((ids) => {
    const m = mapRef.current
    if (ids.includes(m.center) && locRef.current.mapId !== 'root') { deleteCurrentMap(); return }
    // The centre box anchors the map and stays.
    const gone = new Set(ids.filter((id) => id !== m.center))
    if (!gone.size) return
    const { topic: t } = locRef.current
    m.nodes.filter((n) => gone.has(n.id)).forEach((n) => {
      if (n.sub) api.deleteMap(t, n.id).catch(fail)
      if (n.note) api.deleteNote(t, n.id).catch(fail)
    })
    updateMap((cur) => ({
      ...cur,
      nodes: cur.nodes.filter((n) => !gone.has(n.id)),
      links: cur.links.filter((l) => !gone.has(l.a) && !gone.has(l.b) && !gone.has(l.via)),
    }))
    setSelection([])
  }, [updateMap, fail, deleteCurrentMap])

  const addLink = useCallback((a, b) => {
    if (a === b) return
    updateMap((m) => {
      if (m.links.some((l) => pairKey(l.a, l.b) === pairKey(a, b))) return m
      return { ...m, links: [...m.links, { id: uid(), a, b }] }
    })
  }, [updateMap])

  // A link between a box of an outer map and a box inside one of its sub-maps is stored in the outer map.
  const addCrossLink = useCallback(async (storeId, { outer, inner, via, title }) => {
    const link = { id: uid(), a: outer, b: inner, via, ...(title ? { bt: title } : {}) }
    const dup = (l) => l.via === via && l.a === outer && l.b === inner
    if (storeId === locRef.current.mapId) {
      updateMap((m) => (m.links.some(dup) ? m : { ...m, links: [...m.links, link] }))
      return
    }
    try {
      const { topic: t } = locRef.current
      const other = upgradeMap(await api.getMap(t, storeId), '')
      if (other.links.some(dup)) return
      await api.saveMap(t, storeId, { ...other, links: [...other.links, link] })
    } catch (e) { fail(e) }
  }, [updateMap, fail])

  const removeLink = useCallback((id) => {
    updateMap((m) => ({ ...m, links: m.links.filter((l) => l.id !== id) }))
    setSelectedLink(null)
  }, [updateMap])

  const commitLabel = useCallback((id, text) => {
    setEditingLink(null)
    const label = text.trim()
    updateMap((m) => ({
      ...m,
      links: m.links.map((l) => {
        if (l.id !== id || (l.label || '') === label) return l
        const { label: _old, ...rest } = l
        return label ? { ...rest, label } : rest
      }),
    }))
  }, [updateMap])

  // Direction 'none' is the default, so it is stored as the absence of `dir`.
  const patchLink = useCallback((id, patch) => {
    updateMap((m) => ({
      ...m,
      links: m.links.map((l) => {
        if (l.id !== id) return l
        const next = { ...l, ...patch }
        if (!next.label) delete next.label
        if (!next.dir || next.dir === 'none') delete next.dir
        return next
      }),
    }))
  }, [updateMap])

  const commitTitle = useCallback((id, title) => {
    setEditingId(null)
    const t = title.trim()
    if (t) patchNode(id, { title: t })
  }, [patchNode])

  // ---- opening a box as its own map ----
  const openSubmap = useCallback(async (nodeId) => {
    const node = mapRef.current.nodes.find((n) => n.id === nodeId)
    if (!node) return
    if (!node.sub) patchNode(nodeId, { sub: true })
    await flush()
    setLoc((l) => ({ ...l, mapId: nodeId, chain: [...l.chain, { id: nodeId, title: node.title }] }))
  }, [patchNode, flush])

  const goToLevel = useCallback(async (index) => {
    await flush()
    setLoc((l) => ({ ...l, mapId: l.chain[index].id, chain: l.chain.slice(0, index + 1) }))
  }, [flush])

  // Jump to a search hit, which may live in a sub-map: rebuild the breadcrumb by walking up through `parentMap`.
  const jumpTo = async (path, mId, nodeId) => {
    try {
      await flush()
      const crumbs = []
      let id = mId
      while (id && id !== 'root') {
        const own = upgradeMap(await api.getMap(path, id), '')
        const parentId = own.parentMap || 'root'
        const parent = upgradeMap(await api.getMap(path, parentId), '')
        crumbs.unshift({ id, title: parent.nodes.find((n) => n.id === id)?.title || 'Map' })
        id = parentId
      }
      selectAfterLoad.current = nodeId
      setLoc({ topic: path, mapId: mId || 'root', chain: [...rootCrumb(path), ...crumbs] })
    } catch (e) { fail(e) }
  }

  useKeyboardShortcuts({
    mapRef, selection, selectedId, selectedLink,
    setSelection, setSelectedLink, setEditingId, setEditingLink,
    updateMap, addLinkedNode, removeNodes, removeLink,
  })

  useEffect(() => {
    const onHide = () => flush()
    window.addEventListener('beforeunload', onHide)
    window.addEventListener('pagehide', onHide)
    return () => {
      window.removeEventListener('beforeunload', onHide)
      window.removeEventListener('pagehide', onHide)
    }
  }, [flush])

  const selected = map && selectedId ? map.nodes.find((n) => n.id === selectedId) : null
  const pickedLink = map && selectedLink && !selected ? map.links.find((l) => l.id === selectedLink) : null

  return (
    <div className={`app ${selected || pickedLink ? 'with-notes' : ''}`}>
      <Sidebar
        tree={tree}
        active={topic}
        onOpen={openTopic}
        onCreate={createTopic}
        onRename={renameTopic}
        onDelete={deleteTopic}
        onJump={jumpTo}
      />
      <main className="stage">
        {map && loadedKey === `${topic}:${mapId}` ? (
          <MapView
            key={`${topic}:${mapId}`}
            topic={topic}
            map={map}
            mapId={mapId}
            chain={chain}
            goToLevel={goToLevel}
            selection={selection}
            setSelection={setSelection}
            selectedLink={selectedLink}
            setSelectedLink={setSelectedLink}
            editingId={editingId}
            setEditingId={setEditingId}
            editingLink={editingLink}
            setEditingLink={setEditingLink}
            status={status}
            ops={{ updateMap, addNode, addLinkedNode, removeNodes, addLink, addCrossLink, openSubmap, commitTitle, commitLabel }}
          />
        ) : (
          <div className="empty">
            <h2>{topic ? 'Loading…' : 'No topic open'}</h2>
            {!topic && <p>Choose a topic on the left, or use “New topic” to start a map.</p>}
          </div>
        )}
        {error && (
          <div className="toast" role="alert">
            {error}
            <button onClick={() => setError(null)}>Dismiss</button>
          </div>
        )}
      </main>
      {selected && (
        <NotePanel
          key={`${topic}:${selected.id}`}
          topic={topic}
          node={selected}
          onPatch={(patch) => patchNode(selected.id, patch)}
          onClose={() => setSelection([])}
          onError={fail}
        />
      )}
      {pickedLink && (
        <LinkPanel
          key={pickedLink.id}
          link={pickedLink}
          from={map.nodes.find((n) => n.id === pickedLink.a)}
          to={map.nodes.find((n) => n.id === pickedLink.b) || { title: pickedLink.bt || 'Box in sub-map' }}
          onPatch={(patch) => patchLink(pickedLink.id, patch)}
          onRemove={() => removeLink(pickedLink.id)}
          onClose={() => setSelectedLink(null)}
        />
      )}
    </div>
  )
}
