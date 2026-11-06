import { useEffect, useState } from 'react'

// Arrow icons run left to right: the first box is `a` (where the link was drawn from), the second is `b`.
const DIRS = [
  { id: 'none', title: 'No arrow', heads: [] },
  { id: 'a2b', title: 'From first box to second', heads: ['end'] },
  { id: 'b2a', title: 'From second box to first', heads: ['start'] },
  { id: 'both', title: 'Both ways', heads: ['start', 'end'] },
]

function DirIcon({ heads }) {
  return (
    <svg viewBox="0 0 32 16" width="32" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 8h24" />
      {heads.includes('end') && <path d="M23 4l5 4-5 4" />}
      {heads.includes('start') && <path d="M9 4L4 8l5 4" />}
    </svg>
  )
}

export default function LinkPanel({ link, from, to, onPatch, onRemove, onClose }) {
  const [label, setLabel] = useState(link.label || '')
  const dir = link.dir || 'none'

  useEffect(() => setLabel(link.label || ''), [link.label])

  return (
    <aside className="notes">
      <header>
        <h2 className="note-title link-title">Link</h2>
        <button className="close" onClick={onClose} aria-label="Close link panel">Close</button>
      </header>

      <div className="meta">
        <p className="link-ends">{from?.title} — {to?.title}</p>
        <label className="stack">
          Label
          <input
            value={label}
            placeholder="Shown on the link"
            onChange={(e) => setLabel(e.target.value)}
            onBlur={() => onPatch({ label: label.trim() })}
            onKeyDown={(e) => e.key === 'Enter' && e.target.blur()}
          />
        </label>
        <div className="stack">
          <span className="field-name" id="link-dir">Direction</span>
          <div className="dir-options" role="radiogroup" aria-labelledby="link-dir">
            {DIRS.map((d) => (
              <button key={d.id} role="radio" aria-checked={dir === d.id} className={dir === d.id ? 'on' : ''} title={d.title} aria-label={d.title} onClick={() => onPatch({ dir: d.id })}>
                <DirIcon heads={d.heads} />
              </button>
            ))}
          </div>
        </div>
        <button className="danger-btn" onClick={onRemove}>Delete link</button>
      </div>
    </aside>
  )
}
