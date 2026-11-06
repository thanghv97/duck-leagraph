import { useCallback, useEffect, useRef } from 'react'
import { uid } from '../layout.js'

const PASTE_STEP = 40

// All keyboard shortcuts of the map: edit/delete/add on the selection, plus copy & paste of boxes.
export function useKeyboardShortcuts({
  mapRef, selection, selectedId, selectedLink,
  setSelection, setSelectedLink, setEditingId, setEditingLink,
  updateMap, addLinkedNode, removeNodes, removeLink,
}) {
  const clipboard = useRef(null)

  // Copies the selected boxes and the links between them. Sub-maps, notes and bookmarks live under the original
  // box's id, so they are not carried over. The clipboard survives switching maps, so boxes can move between them.
  const copySelection = useCallback(() => {
    const ids = new Set(selection)
    const nodes = mapRef.current.nodes.filter((n) => ids.has(n.id)).map(({ sub: _s, note: _n, bookmark: _b, ...rest }) => rest)
    if (!nodes.length) return
    const links = mapRef.current.links.filter((l) => ids.has(l.a) && ids.has(l.b))
    clipboard.current = { nodes, links, pastes: 0 }
  }, [mapRef, selection])

  const pasteClipboard = useCallback(() => {
    const clip = clipboard.current
    if (!clip) return
    clip.pastes += 1
    const shift = PASTE_STEP * clip.pastes
    const idMap = new Map(clip.nodes.map((n) => [n.id, uid()]))
    const nodes = clip.nodes.map((n) => ({ ...n, id: idMap.get(n.id), x: n.x + shift, y: n.y + shift }))
    const links = clip.links.map((l) => ({ ...l, id: uid(), a: idMap.get(l.a), b: idMap.get(l.b) }))
    updateMap((m) => ({ ...m, nodes: [...m.nodes, ...nodes], links: [...m.links, ...links] }))
    setSelection(nodes.map((n) => n.id))
    setSelectedLink(null)
  }, [updateMap, setSelection, setSelectedLink])

  useEffect(() => {
    const onKey = (e) => {
      if (!mapRef.current) return
      if (e.target.closest?.('input, textarea, select, [contenteditable]')) return
      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        const k = e.key.toLowerCase()
        if (k === 'c' && selection.length) { e.preventDefault(); copySelection() }
        if (k === 'v' && clipboard.current) { e.preventDefault(); pasteClipboard() }
        return
      }
      if (!selection.length && !selectedLink) return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const del = e.key === 'Delete' || e.key === 'Backspace'
      if (selectedLink) {
        if (del) { e.preventDefault(); removeLink(selectedLink) }
        if (e.key === 'Enter' || e.key === 'F2') { e.preventDefault(); setEditingLink(selectedLink) }
        if (e.key === 'Escape') setSelectedLink(null)
        return
      }
      const actions = selection.length > 1 ? {
        Delete: () => removeNodes(selection),
        Backspace: () => removeNodes(selection),
        Escape: () => setSelection([]),
      } : {
        Tab: () => addLinkedNode(selectedId),
        F2: () => setEditingId(selectedId),
        Enter: () => setEditingId(selectedId),
        Delete: () => removeNodes(selection),
        Backspace: () => removeNodes(selection),
        Escape: () => setSelection([]),
      }
      const act = actions[e.key]
      if (!act) return
      e.preventDefault()
      act()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mapRef, selection, selectedId, selectedLink, setSelection, setSelectedLink, setEditingId, setEditingLink,
    addLinkedNode, removeNodes, removeLink, copySelection, pasteClipboard])
}
