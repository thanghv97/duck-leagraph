// Edit token from the password prompt. Stored in localStorage with its expiry (8h, enforced by the server too),
// so reloading the page keeps editing unlocked until it runs out.
const TOKEN_KEY = 'editSession'
let editToken = null
export const setEditToken = (t, expires) => {
  editToken = t
  try {
    if (t) localStorage.setItem(TOKEN_KEY, JSON.stringify({ token: t, expires }))
    else localStorage.removeItem(TOKEN_KEY)
  } catch { /* storage unavailable: the session just lasts until reload */ }
}
// Reads a stored, unexpired token into memory. Returns whether there is one (the server still has to confirm it).
export const loadEditToken = () => {
  try {
    const s = JSON.parse(localStorage.getItem(TOKEN_KEY))
    if (s?.token && s.expires > Date.now()) { editToken = s.token; return true }
  } catch { /* ignore */ }
  setEditToken(null)
  return false
}

async function call(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(editToken ? { 'X-Edit-Token': editToken } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    // Lets a save started while the page is closing or reloading still reach the server.
    keepalive: method === 'PUT',
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`)
  return data
}

const q = (params) => new URLSearchParams(params).toString()

export const api = {
  unlock: (password) => call('POST', '/api/unlock', { password }),
  session: () => call('GET', '/api/session'),
  tree: () => call('GET', '/api/tree'),
  createFolder: (path) => call('POST', '/api/folder', { path }),
  renameFolder: (from, to) => call('POST', '/api/rename', { from, to }),
  deleteFolder: (path) => call('DELETE', `/api/folder?${q({ path })}`),
  getMap: (path, map = 'root') => call('GET', `/api/map?${q({ path, map })}`),
  saveMap: (path, map, data) => call('PUT', `/api/map?${q({ path, map })}`, data),
  deleteMap: (path, map) => call('DELETE', `/api/map?${q({ path, map })}`),
  getNote: (path, id) => call('GET', `/api/note?${q({ path, id })}`),
  saveNote: (path, id, content) => call('PUT', `/api/note?${q({ path, id })}`, { content }),
  deleteNote: (path, id) => call('DELETE', `/api/note?${q({ path, id })}`),
  // Stores a pasted image next to the topic's notes and returns the file name to reference from markdown.
  uploadImage: async (path, id, blob) => {
    const res = await fetch(`/api/image?${q({ path, id })}`, { method: 'PUT', headers: { 'Content-Type': blob.type, ...(editToken ? { 'X-Edit-Token': editToken } : {}) }, body: blob })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || `Upload failed (${res.status})`)
    return data.name
  },
  search: (text) => call('GET', `/api/search?${q({ q: text })}`),
}
