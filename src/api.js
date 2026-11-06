async function call(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
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
  uploadImage: async (path, blob) => {
    const res = await fetch(`/api/image?${q({ path })}`, { method: 'PUT', headers: { 'Content-Type': blob.type }, body: blob })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || `Upload failed (${res.status})`)
    return data.name
  },
  search: (text) => call('GET', `/api/search?${q({ q: text })}`),
}
