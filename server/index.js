import express from 'express'
import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const KNOWLEDGE = path.join(ROOT, 'knowledge')
const DIST = path.join(ROOT, 'dist')
const PORT = process.env.PORT || 5174

const NOTES_DIR = '_notes'
const MAPS_DIR = '_maps' // sub-maps: one file per node that was opened as its own map
const IMG_DIR = '_img' // pasted note images live in _notes/_img
const MAP_FILE = 'map.json'
const RESERVED = new Set([NOTES_DIR, MAPS_DIR])

const app = express()
app.use(express.json({ limit: '5mb' }))

// Editing is locked until a client unlocks with the password. A token is valid for 8 hours and the page keeps it
// in localStorage, so a reload stays unlocked. Tokens live in server memory only, so a server restart locks everyone.
const EDIT_PASSWORD = process.env.EDIT_PASSWORD || 'duck-edit'
if (!process.env.EDIT_PASSWORD) console.warn('EDIT_PASSWORD is not set, using the default password. Set it before exposing the app.')
const TOKEN_TTL = 8 * 60 * 60 * 1000
const editTokens = new Map() // token -> expiry timestamp
const validToken = (t) => {
  const exp = editTokens.get(t)
  if (exp === undefined) return false
  if (exp <= Date.now()) { editTokens.delete(t); return false }
  return true
}
const safeEqual = (a, b) => {
  const ha = crypto.createHash('sha256').update(String(a)).digest()
  const hb = crypto.createHash('sha256').update(String(b)).digest()
  return crypto.timingSafeEqual(ha, hb)
}
let lastFail = 0
app.post('/api/unlock', (req, res) => {
  // Slow down password guessing.
  if (Date.now() - lastFail < 1000) return res.status(429).json({ error: 'Too many attempts, try again in a moment' })
  if (!safeEqual(req.body?.password ?? '', EDIT_PASSWORD)) {
    lastFail = Date.now()
    return res.status(401).json({ error: 'Wrong password' })
  }
  const token = crypto.randomBytes(24).toString('hex')
  const expires = Date.now() + TOKEN_TTL
  editTokens.set(token, expires)
  for (const [t, exp] of editTokens) if (exp <= Date.now()) editTokens.delete(t)
  res.json({ token, expires })
})
// Lets a reloaded page check that its stored token is still accepted.
app.get('/api/session', (req, res) => {
  if (!validToken(req.get('x-edit-token'))) return res.status(401).json({ error: 'Session expired' })
  res.json({ ok: true })
})
app.use('/api', (req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD') return next()
  if (!validToken(req.get('x-edit-token'))) return res.status(401).json({ error: 'Editing is locked. Enter the password to edit.' })
  next()
})

class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

// Turns a client path like "Database/Oracle" into an absolute path inside knowledge/.
function resolveTopic(rel) {
  const parts = String(rel || '').split('/').filter(Boolean)
  for (const p of parts) {
    if (p === '.' || p === '..' || p.startsWith('.') || RESERVED.has(p) || /[<>:"\\|?*\x00-\x1f]/.test(p)) {
      throw new HttpError(400, `Invalid name "${p}"`)
    }
  }
  return { parts, abs: path.join(KNOWLEDGE, ...parts) }
}

// 'root' is the topic's own map; any other id is the node that owns the sub-map.
function mapFile(topicAbs, id) {
  if (!id || id === 'root') return path.join(topicAbs, MAP_FILE)
  if (!/^[\w-]+$/.test(id)) throw new HttpError(400, 'Invalid map id')
  return path.join(topicAbs, MAPS_DIR, `${id}.json`)
}

function noteFile(topicAbs, id) {
  if (!/^[\w-]+$/.test(id || '')) throw new HttpError(400, 'Invalid node id')
  return path.join(topicAbs, NOTES_DIR, `${id}.md`)
}

const readIfExists = async (file) => {
  try {
    return await fs.readFile(file, 'utf8')
  } catch (e) {
    if (e.code === 'ENOENT') return null
    throw e
  }
}

async function scan(dir, rel = '') {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const out = []
  for (const e of entries) {
    if (!e.isDirectory() || RESERVED.has(e.name) || e.name.startsWith('.')) continue
    const p = rel ? `${rel}/${e.name}` : e.name
    out.push({
      name: e.name,
      path: p,
      hasMap: existsSync(path.join(dir, e.name, MAP_FILE)),
      children: await scan(path.join(dir, e.name), p),
    })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
}

const wrap = (fn) => (req, res) =>
  fn(req, res).catch((err) => {
    const status = err.status || 500
    if (status === 500) console.error(err)
    res.status(status).json({ error: err.message })
  })

app.get('/api/tree', wrap(async (req, res) => {
  await fs.mkdir(KNOWLEDGE, { recursive: true })
  res.json(await scan(KNOWLEDGE))
}))

app.post('/api/folder', wrap(async (req, res) => {
  const { abs, parts } = resolveTopic(req.body.path)
  if (!parts.length) throw new HttpError(400, 'Name is required')
  if (existsSync(abs)) throw new HttpError(409, 'A topic with that name already exists here')
  await fs.mkdir(abs, { recursive: true })
  res.json({ ok: true })
}))

app.post('/api/rename', wrap(async (req, res) => {
  const from = resolveTopic(req.body.from)
  const to = resolveTopic(req.body.to)
  if (!existsSync(from.abs)) throw new HttpError(404, 'Topic not found')
  if (existsSync(to.abs)) throw new HttpError(409, 'A topic with that name already exists here')
  await fs.rename(from.abs, to.abs)
  res.json({ ok: true })
}))

app.delete('/api/folder', wrap(async (req, res) => {
  const { abs, parts } = resolveTopic(req.query.path)
  if (!parts.length) throw new HttpError(400, 'Path is required')
  await fs.rm(abs, { recursive: true, force: true })
  res.json({ ok: true })
}))

app.get('/api/map', wrap(async (req, res) => {
  const { abs } = resolveTopic(req.query.path)
  const text = await readIfExists(mapFile(abs, req.query.map))
  res.json(text ? JSON.parse(text) : null)
}))

app.put('/api/map', wrap(async (req, res) => {
  const { abs } = resolveTopic(req.query.path)
  const file = mapFile(abs, req.query.map)
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, JSON.stringify(req.body, null, 2))
  res.json({ ok: true })
}))

// Removes a sub-map together with everything inside it: notes and the sub-maps of its own nodes.
async function deleteMapTree(topicAbs, id) {
  const file = mapFile(topicAbs, id)
  const text = await readIfExists(file)
  if (text) {
    for (const n of JSON.parse(text).nodes || []) {
      if (n.sub) await deleteMapTree(topicAbs, n.id)
      await fs.rm(noteFile(topicAbs, n.id), { force: true })
    }
  }
  await fs.rm(file, { force: true })
}

app.delete('/api/map', wrap(async (req, res) => {
  const { abs } = resolveTopic(req.query.path)
  if (!req.query.map || req.query.map === 'root') throw new HttpError(400, 'Only sub-maps can be deleted here')
  await deleteMapTree(abs, req.query.map)
  res.json({ ok: true })
}))

app.get('/api/note', wrap(async (req, res) => {
  const { abs } = resolveTopic(req.query.path)
  res.json({ content: (await readIfExists(noteFile(abs, req.query.id))) ?? '' })
}))

app.put('/api/note', wrap(async (req, res) => {
  const { abs } = resolveTopic(req.query.path)
  const file = noteFile(abs, req.query.id)
  const content = String(req.body.content ?? '')
  if (content.trim()) {
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, content)
  } else {
    await fs.rm(file, { force: true })
  }
  res.json({ ok: true })
}))

// Images pasted into notes. SVG is left out on purpose: it can carry script.
const IMAGE_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' }

app.put('/api/image', express.raw({ type: Object.keys(IMAGE_TYPES), limit: '10mb' }), wrap(async (req, res) => {
  const { abs } = resolveTopic(req.query.path)
  const ext = IMAGE_TYPES[String(req.headers['content-type']).split(';')[0]]
  if (!ext || !Buffer.isBuffer(req.body) || !req.body.length) throw new HttpError(400, 'Unsupported image type')
  // Images are named <box id>_<index>, the index continuing after the box's highest existing one.
  const id = String(req.query.id || '')
  if (!/^[\w-]+$/.test(id)) throw new HttpError(400, 'Invalid box id')
  const dir = path.join(abs, NOTES_DIR, IMG_DIR)
  await fs.mkdir(dir, { recursive: true })
  const prefix = `${id}_`
  const used = (await fs.readdir(dir)).map((f) => (f.startsWith(prefix) ? Number(f.slice(prefix.length).split('.')[0]) : 0)).filter(Number.isInteger)
  const name = `${prefix}${Math.max(0, ...used) + 1}.${ext}`
  await fs.writeFile(path.join(dir, name), req.body)
  res.json({ name })
}))

app.get('/api/image', wrap(async (req, res) => {
  const { abs } = resolveTopic(req.query.path)
  const name = String(req.query.name || '')
  if (!/^[\w-]+\.(png|jpg|gif|webp)$/.test(name)) throw new HttpError(400, 'Invalid image name')
  const file = path.join(abs, NOTES_DIR, IMG_DIR, name)
  if (!existsSync(file)) throw new HttpError(404, 'Image not found')
  res.sendFile(file)
}))

app.delete('/api/note', wrap(async (req, res) => {
  const { abs } = resolveTopic(req.query.path)
  await fs.rm(noteFile(abs, req.query.id), { force: true })
  res.json({ ok: true })
}))

// Walks every topic folder and returns the ones that hold a map.
async function* topics(dir = KNOWLEDGE, rel = '') {
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    if (!e.isDirectory() || RESERVED.has(e.name) || e.name.startsWith('.')) continue
    const p = rel ? `${rel}/${e.name}` : e.name
    const abs = path.join(dir, e.name)
    if (existsSync(path.join(abs, MAP_FILE))) yield { path: p, abs }
    yield* topics(abs, p)
  }
}

// The root map plus every sub-map of a topic.
async function* mapsOf(topicAbs) {
  yield { id: 'root', file: path.join(topicAbs, MAP_FILE) }
  const dir = path.join(topicAbs, MAPS_DIR)
  if (!existsSync(dir)) return
  for (const f of await fs.readdir(dir)) {
    if (f.endsWith('.json')) yield { id: f.slice(0, -5), file: path.join(dir, f) }
  }
}

app.get('/api/search', wrap(async (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase()
  if (q.length < 2) return res.json([])
  const results = []
  for await (const t of topics()) {
    for await (const m of mapsOf(t.abs)) {
      const map = JSON.parse(await fs.readFile(m.file, 'utf8'))
      for (const n of map.nodes || []) {
        const note = (await readIfExists(noteFile(t.abs, n.id))) ?? ''
        const inTitle = n.title.toLowerCase().includes(q) || (n.desc || '').toLowerCase().includes(q) || (n.tags || []).some((x) => x.toLowerCase().includes(q))
        const at = note.toLowerCase().indexOf(q)
        if (!inTitle && at < 0) continue
        results.push({
          topic: t.path,
          map: m.id,
          nodeId: n.id,
          title: n.title,
          snippet: at >= 0 ? note.slice(Math.max(0, at - 30), at + 70).replace(/\s+/g, ' ') : '',
        })
        if (results.length >= 50) return res.json(results)
      }
    }
  }
  res.json(results)
}))

if (existsSync(DIST)) {
  app.use(express.static(DIST))
  app.get(/^\/(?!api).*/, (req, res) => res.sendFile(path.join(DIST, 'index.html')))
}

app.listen(PORT, () => console.log(`Duck LeaGraph API on http://localhost:${PORT}`))
