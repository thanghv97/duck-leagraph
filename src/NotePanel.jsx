import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { marked } from 'marked'
import { markedHighlight } from 'marked-highlight'
import hljs from 'highlight.js/lib/common'
import DOMPurify from 'dompurify'
import { api } from './api.js'
import { PALETTE } from './layout.js'

marked.use(markedHighlight({
  langPrefix: 'hljs language-',
  highlight: (code, lang) => hljs.highlight(code, { language: hljs.getLanguage(lang) ? lang : 'plaintext' }).value,
}))

DOMPurify.addHook('afterSanitizeAttributes', (el) => {
  if (el.tagName === 'A') {
    el.setAttribute('target', '_blank')
    el.setAttribute('rel', 'noopener noreferrer')
  }
})

export default function NotePanel({ topic, node, onPatch, onClose, onError }) {
  const [text, setText] = useState('')
  const [ready, setReady] = useState(false)
  const [mode, setMode] = useState('write')
  const [title, setTitle] = useState(node.title)
  const [tags, setTags] = useState((node.tags || []).join(', '))

  const pending = useRef(null)
  const timer = useRef()

  const flush = useCallback(() => {
    clearTimeout(timer.current)
    const p = pending.current
    if (!p) return
    pending.current = null
    api.saveNote(p.topic, p.id, p.text).catch(onError)
  }, [onError])

  useEffect(() => {
    let live = true
    api.getNote(topic, node.id).then((r) => {
      if (!live) return
      setText(r.content)
      setMode(r.content ? 'preview' : 'write')
      setReady(true)
    }).catch(onError)
    return () => { live = false; flush() }
  }, [topic, node.id, flush, onError])

  // Typing is saved after a short pause; also save when the page is reloaded or closed inside that pause.
  useEffect(() => {
    window.addEventListener('pagehide', flush)
    return () => window.removeEventListener('pagehide', flush)
  }, [flush])

  useEffect(() => setTitle(node.title), [node.title])

  const onText = (value) => {
    setText(value)
    pending.current = { topic, id: node.id, text: value }
    clearTimeout(timer.current)
    timer.current = setTimeout(flush, 700)
    if (!!value.trim() !== !!node.note) onPatch({ note: !!value.trim() })
  }

  // Notes refer to pasted images as image:<file>, so renaming or moving a topic does not break them.
  const html = useMemo(() => {
    const raw = marked.parse(text || '').replace(/src="image:([\w.-]+)"/g, (_, name) => `src="/api/image?path=${encodeURIComponent(topic)}&name=${name}"`)
    return DOMPurify.sanitize(raw)
  }, [text, topic])

  // Paste or drop an image into the editor: save it, then drop a markdown reference at the cursor.
  const editor = useRef(null)
  const addImage = async (file) => {
    const at = editor.current?.selectionStart ?? text.length
    try {
      const name = await api.uploadImage(topic, file)
      const next = `${text.slice(0, at)}
![image](image:${name})
${text.slice(at)}`
      onText(next)
    } catch (e) { onError(e) }
  }
  const onFiles = (e, files) => {
    const img = [...files].find((f) => f.type.startsWith('image/'))
    if (!img) return
    e.preventDefault()
    addImage(img)
  }

  const commitTags = () =>
    onPatch({ tags: tags.split(',').map((t) => t.trim()).filter(Boolean) })

  return (
    <aside className="notes">
      <header>
        <input
          className="note-title"
          value={title}
          aria-label="Node title"
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => title.trim() ? onPatch({ title: title.trim() }) : setTitle(node.title)}
          onKeyDown={(e) => e.key === 'Enter' && e.target.blur()}
        />
        <button
          className={`bookmark ${node.bookmark ? 'on' : ''}`}
          aria-pressed={!!node.bookmark}
          title={node.bookmark ? 'Remove bookmark' : 'Bookmark this box'}
          aria-label="Bookmark"
          onClick={() => onPatch({ bookmark: !node.bookmark })}
        >
          <svg viewBox="0 0 16 16" width="16" height="16" fill={node.bookmark ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
            <path d="M4 2.5h8v11L8 10.5l-4 3z" />
          </svg>
        </button>
        <button className="close" onClick={onClose} aria-label="Close notes">Close</button>
      </header>

      <div className="meta">
        <label className="stack">
          Description
          <textarea className="desc-input" rows={2} value={node.desc || ''} placeholder="Shown on the box under the title" onChange={(e) => onPatch({ desc: e.target.value })} />
        </label>
        <label>
          Tags
          <input value={tags} placeholder="replication, wal" onChange={(e) => setTags(e.target.value)} onBlur={commitTags} onKeyDown={(e) => e.key === 'Enter' && e.target.blur()} />
        </label>
        <label>
          Link
          <input value={node.link || ''} placeholder="https://" onChange={(e) => onPatch({ link: e.target.value })} />
        </label>
        <label className="check"><input type="checkbox" checked={!!node.filled} onChange={(e) => onPatch({ filled: e.target.checked })} /> Solid fill</label>
        <div className="swatches" role="radiogroup" aria-label="Node colour">
          <button role="radio" aria-checked={node.color === '#1b2330'} className={node.color === '#1b2330' ? 'on' : ''} style={{ background: '#1b2330' }} onClick={() => onPatch({ color: '#1b2330' })} title="Ink" />
          {PALETTE.map((c) => (
            <button key={c} role="radio" aria-checked={node.color === c} className={node.color === c ? 'on' : ''} style={{ background: c }} onClick={() => onPatch({ color: c })} title={c} />
          ))}
        </div>
      </div>

      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={mode === 'write'} onClick={() => setMode('write')}>Write</button>
        <button role="tab" aria-selected={mode === 'preview'} onClick={() => setMode('preview')}>Preview</button>
        {node.link && <a href={node.link} target="_blank" rel="noopener noreferrer">Open link</a>}
      </div>

      {!ready ? (
        <p className="hint">Loading notes…</p>
      ) : mode === 'write' ? (
        <textarea
          className="editor"
          value={text}
          placeholder={'Write notes in Markdown.\n\n```sql\nSELECT 1;\n```'}
          ref={editor}
          onChange={(e) => onText(e.target.value)}
          onPaste={(e) => onFiles(e, e.clipboardData.files)}
          onDrop={(e) => onFiles(e, e.dataTransfer.files)}
          spellCheck={false}
        />
      ) : text ? (
        <div className="prose" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <p className="hint">No notes yet. Switch to Write to add some.</p>
      )}
    </aside>
  )
}
