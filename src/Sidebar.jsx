import { useEffect, useState } from 'react'
import { api } from './api.js'

function NameInput({ initial = '', placeholder, onSubmit, onCancel }) {
  const [value, setValue] = useState(initial)
  return (
    <input
      className="name-input"
      autoFocus
      value={value}
      placeholder={placeholder}
      onFocus={(e) => e.target.select()}
      onChange={(e) => setValue(e.target.value)}
      onBlur={onCancel}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && value.trim()) onSubmit(value.trim())
        if (e.key === 'Escape') onCancel()
      }}
    />
  )
}

const Icon = ({ d }) => (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
)

function Branch({ node, depth, ctx }) {
  const { active, open, toggleOpen, mode, setMode, onOpen, onCreate, onRename, onDelete, authed, openTopics, requestLock } = ctx
  const isOpen = open.has(node.path)
  const isActive = active === node.path
  const editing = mode?.path === node.path ? mode.type : null
  const pad = { paddingLeft: 10 + depth * 16 }
  const unlocked = authed && openTopics.has(node.path)

  return (
    <li>
      {editing === 'rename' ? (
        <div className="row" style={pad}>
          <NameInput initial={node.name} onSubmit={(n) => (setMode(null), onRename(node.path, n))} onCancel={() => setMode(null)} />
        </div>
      ) : editing === 'delete' ? (
        <div className="row confirm" style={pad}>
          <span>Delete “{node.name}” and all its maps?</span>
          <button className="danger" onMouseDown={(e) => e.preventDefault()} onClick={() => (setMode(null), onDelete(node.path))}>Delete</button>
          <button onClick={() => setMode(null)}>Keep</button>
        </div>
      ) : (
        <div className={`row ${isActive ? 'active' : ''}`} style={pad}>
          <button
            className="chev"
            aria-label={isOpen ? 'Collapse' : 'Expand'}
            onClick={() => toggleOpen(node.path)}
            style={{ visibility: node.children.length ? 'visible' : 'hidden' }}
          >
            <Icon d={isOpen ? 'M3 6l5 5 5-5' : 'M6 3l5 5-5 5'} />
          </button>
          <button
            className="name"
            onClick={() => {
              onOpen(node.path)
              if (node.children.length && !isOpen) toggleOpen(node.path)
            }}
          >
            {node.name}
          </button>
          {unlocked && <span className="actions">
            <button title="Add subtopic" onClick={() => (toggleOpen(node.path, true), setMode({ type: 'add', path: node.path }))}><Icon d="M8 3v10M3 8h10" /></button>
            <button title="Rename" onClick={() => setMode({ type: 'rename', path: node.path })}><Icon d="M3 13l1-3 7-7 2 2-7 7-3 1z" /></button>
            <button title="Delete" onClick={() => setMode({ type: 'delete', path: node.path })}><Icon d="M4 5h8M6 5V3h4v2M5 5l.5 8h5L11 5" /></button>
          </span>}
          <button
            className={`lock ${unlocked ? 'open' : ''}`}
            title={unlocked ? 'Unlocked for editing. Click to lock' : 'Locked. Click to unlock for editing'}
            aria-label={unlocked ? 'Lock topic' : 'Unlock topic'}
            aria-pressed={unlocked}
            onClick={() => requestLock(node.path)}
          >
            <Icon d={unlocked ? 'M4 7.5h8v6H4zM5.5 7.5V5a2.5 2.5 0 0 1 4.8-1' : 'M4 7.5h8v6H4zM5.5 7.5V5a2.5 2.5 0 0 1 5 0v2.5'} />
          </button>
        </div>
      )}
      {(isOpen || editing === 'add') && (
        <ul>
          {node.children.map((c) => <Branch key={c.path} node={c} depth={depth + 1} ctx={ctx} />)}
          {mode?.type === 'add' && mode.path === node.path && (
            <li className="row" style={{ paddingLeft: 10 + (depth + 1) * 16 + 22 }}>
              <NameInput placeholder="Subtopic name" onSubmit={(n) => (setMode(null), onCreate(node.path, n))} onCancel={() => setMode(null)} />
            </li>
          )}
        </ul>
      )}
    </li>
  )
}

export default function Sidebar({ tree, active, onOpen, onCreate, onRename, onDelete, onJump, authed, openTopics, onToggleLock, onUnlock, onCollapse }) {
  const [open, setOpen] = useState(() => new Set(JSON.parse(localStorage.getItem('open') || '[]')))
  const [mode, setMode] = useState(null) // { type: 'add' | 'rename' | 'delete', path }
  const [query, setQuery] = useState('')
  const [results, setResults] = useState(null)

  useEffect(() => localStorage.setItem('open', JSON.stringify([...open])), [open])

  // Keep the active topic's ancestors expanded.
  useEffect(() => {
    if (!active?.includes('/')) return
    const parts = active.split('/').slice(0, -1)
    setOpen((o) => {
      const next = new Set(o)
      parts.forEach((_, i) => next.add(parts.slice(0, i + 1).join('/')))
      return next
    })
  }, [active])

  useEffect(() => {
    if (query.trim().length < 2) return setResults(null)
    const t = setTimeout(() => api.search(query).then(setResults).catch(() => setResults([])), 250)
    return () => clearTimeout(t)
  }, [query])

  const toggleOpen = (path, force) =>
    setOpen((o) => {
      const next = new Set(o)
      if (force || !next.has(path)) next.add(path)
      else next.delete(path)
      return next
    })

  const [unlocking, setUnlocking] = useState(null) // topic path waiting for the password
  const [pw, setPw] = useState('')
  const [pwError, setPwError] = useState('')
  const submitPw = async (e) => {
    e.preventDefault()
    try {
      await onUnlock(pw)
      onToggleLock(unlocking)
      setUnlocking(null)
      setPw('')
      setPwError('')
    } catch (err) { setPwError(err.message) }
  }

  // The password is only needed the first time; after that a lock toggles freely.
  const requestLock = (path) => (authed ? onToggleLock(path) : (setPwError(''), setUnlocking(path)))

  const ctx = { active, open, toggleOpen, mode, setMode, onOpen, onCreate, onRename, onDelete, authed, openTopics, requestLock }

  return (
    <aside className="sidebar">
      <header>
        <button className="nav-collapse" onClick={onCollapse} aria-label="Hide menu" title="Hide menu">
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 3L5 8l5 5" /></svg>
        </button>
        <h1>Duck LeaGraph</h1>
        <input
          type="search"
          className="search"
          placeholder="Search nodes and notes"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </header>

      {results ? (
        <ul className="results">
          {results.length === 0 && <li className="none">Nothing matches “{query}”.</li>}
          {results.map((r) => (
            <li key={`${r.topic}:${r.nodeId}`}>
              <button onClick={() => (setQuery(''), onJump(r.topic, r.map, r.nodeId))}>
                <strong>{r.title}</strong>
                <small>{r.topic.replace(/\//g, ' › ')}</small>
                {r.snippet && <em>…{r.snippet}…</em>}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <nav>
          <ul className="tree">
            {tree.map((n) => <Branch key={n.path} node={n} depth={0} ctx={ctx} />)}
            {mode?.type === 'add' && mode.path === '' && (
              <li className="row" style={{ paddingLeft: 32 }}>
                <NameInput placeholder="Topic name" onSubmit={(n) => (setMode(null), onCreate('', n))} onCancel={() => setMode(null)} />
              </li>
            )}
          </ul>
          {tree.length === 0 && <p className="hint">No topics yet. Add one to start your first map.</p>}
        </nav>
      )}

      <footer>
        {unlocking !== null && !authed ? (
          <form onSubmit={submitPw} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <input type="password" autoFocus value={pw} placeholder="Edit password" aria-label="Edit password" onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setUnlocking(null)} />
            {pwError && <small role="alert">{pwError}</small>}
            <span style={{ display: 'flex', gap: 6 }}>
              <button className="new" type="submit">Unlock</button>
              <button type="button" onClick={() => (setUnlocking(null), setPwError(''))}>Cancel</button>
            </span>
          </form>
        ) : authed ? (
          <button className="new" onClick={() => setMode({ type: 'add', path: '' })}>New topic</button>
        ) : (
          <p className="hint">View only. Click a topic's lock to edit.</p>
        )}
      </footer>
    </aside>
  )
}
