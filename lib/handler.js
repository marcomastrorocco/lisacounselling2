/* ---------- one request handler, two homes ----------
   This is the whole console and the whole published site. It is plain Node
   (request, response), so the same code runs as a Vercel function in production
   and behind local-server.js while you work. The only difference is that the
   dev server also serves the project's static files from disk; in production
   Vercel's CDN has already served those before a request reaches here. */

const fs = require('fs')
const path = require('path')
const store = require('./store')
const site = require('./site')
const auth = require('./auth')

const root = path.join(__dirname, '..')
const mime = {'.css':'text/css; charset=utf-8','.html':'text/html; charset=utf-8','.ico':'image/x-icon','.jpeg':'image/jpeg','.jpg':'image/jpeg','.js':'text/javascript; charset=utf-8','.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.webp':'image/webp','.xml':'application/xml','.txt':'text/plain; charset=utf-8','.woff2':'font/woff2'}

// Everything the sign-in page itself needs, before any session exists.
const openPaths = new Set(['/admin/login.html', '/admin/login.js', '/admin/app.css', '/admin/favicon.ico'])

/* Five seconds, and deliberately no stale-while-revalidate.

   A minute with a five-minute grace period was the first try, and it made the
   console feel broken: save a page, reload it, and the old words were still
   there — for over a minute, because the grace period lets the CDN answer from
   the stale copy while it fetches the new one behind your back. Someone editing
   their own site reads that as "it didn't save".

   Five seconds is short enough to feel immediate and still absorbs a burst of
   traffic on one page. The cost is that the function runs more often, which for
   a site this size is nothing. */
const PAGE_CACHE = 'public, max-age=0, s-maxage=5'

/* Images are the opposite case. An uploaded name carries the moment it was
   uploaded and is never reused, so an address always means the same bytes and
   there is nothing to go stale — cache it as long as a browser will. */
const MEDIA_CACHE = 'public, max-age=31536000, immutable'

/* Video is answered with a redirect to a signed URL rather than the bytes, and
   that URL stops working when its signature expires. So the redirect may only
   be cached for a fraction of the signature's life: long enough that a player
   seeking through a clip is not asking for a new one every few seconds, short
   enough that nothing ever holds a URL past the point where it still works. */
const SIGNED_SECONDS = 3600
const VIDEO_REDIRECT_CACHE = 'public, max-age=300, s-maxage=300'

function send(response, status, data, type = 'application/json; charset=utf-8', headers = {}) {
  response.writeHead(status, {'Content-Type': type, ...headers})
  response.end(Buffer.isBuffer(data) || typeof data === 'string' ? data : JSON.stringify(data))
}

function readBody(request) {
  // Vercel parses a JSON body for us; the dev server hands over the raw stream.
  if (request.body && typeof request.body === 'object') return Promise.resolve(request.body)
  if (typeof request.body === 'string') return Promise.resolve(JSON.parse(request.body || '{}'))
  return new Promise((resolve, reject) => {
    let body = ''
    request.on('data', chunk => { body += chunk; if (body.length > 8 * 1024 * 1024) reject(new Error('Request is too large')) })
    request.on('end', () => { try { resolve(JSON.parse(body || '{}')) } catch { reject(new Error('Invalid request data')) } })
    request.on('error', reject)
  })
}

/* Best effort only. Each serverless instance keeps its own tally, so this slows
   a guesser down rather than stopping one outright; the password's length is
   what actually protects the console. */
const failures = new Map()

function clientOf(request) {
  const forwarded = String(request.headers['x-forwarded-for'] || '').split(',')[0].trim()
  return forwarded || (request.socket && request.socket.remoteAddress) || 'unknown'
}

function lockedFor(client) {
  const entry = failures.get(client)
  return entry && entry.until > Date.now() ? Math.ceil((entry.until - Date.now()) / 1000) : 0
}

function countFailure(client) {
  const entry = failures.get(client)
  const count = (entry ? entry.count : 0) + 1
  failures.set(client, {count, until: count >= 5 ? Date.now() + 60000 : 0})
  return count
}

const readPages = options => store.readJson(store.PAGES, site.seedPages, options)

async function readProfile(options) {
  const saved = await store.readJson(store.PROFILE, {}, options)
  return {...site.defaultProfile, ...saved}
}

/* ---------- where each uploaded file is shown ----------
   The library offers to delete a file, so it has to be able to tell one nothing
   points at any more from one holding up a live page. Everything the console
   can write is read back and scanned: the pages, the shared header and footer,
   and the profile photo. Returns name -> the places that show it. */
async function mediaUsage() {
  const pages = await readPages({fresh: true})
  const documents = await Promise.all(pages.map(async page => ({
    label: page.label,
    text: await store.readText(store.pageKey(page.id), {fresh: true}),
  })))
  documents.push({label: 'the menu and footer', text: await store.readText(store.SHELL, {fresh: true})})
  documents.push({label: 'your profile photo', text: (await readProfile({fresh: true})).photo})

  const usage = new Map()
  for (const {label, text} of documents) {
    for (const name of site.mediaNamesIn(text)) {
      const places = usage.get(name) || []
      if (!places.includes(label)) places.push(label)
      usage.set(name, places)
    }
  }
  return usage
}

/* The navigation and the sitemap are single documents the console edits in
   place, so read, change, write — and report honestly when the anchors the
   edit needs are not where they were expected. */
async function editShell(action, page) {
  const shell = await store.readText(store.SHELL, {fresh: true})
  const next = site.updateNavigation(shell, action, page)
  if (next === null) return false
  await store.writeText(store.SHELL, next, mime['.js'])
  return true
}

async function editSitemap(action, href) {
  const xml = await store.readText(store.SITEMAP, {fresh: true})
  const next = site.updateSitemap(xml, action, href)
  if (next === null) return false
  await store.writeText(store.SITEMAP, next, mime['.xml'])
  return true
}

function sendFile(response, file) {
  const safe = path.resolve(file)
  if (safe !== root && !safe.startsWith(root + path.sep)) {
    return send(response, 403, 'Forbidden', 'text/plain; charset=utf-8')
  }
  const target = path.extname(safe) ? safe : path.join(safe, 'index.html')
  fs.readFile(target, (error, data) => error
    ? send(response, 404, 'Not found', 'text/plain; charset=utf-8')
    : send(response, 200, data, mime[path.extname(target)] || 'application/octet-stream'))
}

module.exports = async function handler(request, response) {
  const url = new URL(request.url, 'http://localhost')
  const method = request.method || 'GET'
  const host = request.headers.host

  if (!store.configured()) {
    return send(response, 500, {error: 'This server has no Blob store — BLOB_READ_WRITE_TOKEN is not set.'})
  }

  /* ---------- sign in and out ---------- */

  if (url.pathname === '/api/login' && method === 'POST') {
    if (!auth.ready()) {
      return send(response, 500, {error: 'This server cannot sign anyone in — SESSION_SECRET is not set.'})
    }
    if (!await auth.hasPassword()) {
      return send(response, 500, {error: 'This server has no password — set SPES_ADMIN_PASSWORD and try again.'})
    }
    const client = clientOf(request)
    const wait = lockedFor(client)
    if (wait) return send(response, 429, {error: `Too many attempts — wait ${wait} seconds.`})
    try {
      const body = await readBody(request)
      if (!await auth.passwordMatches(body.password || '')) {
        const count = countFailure(client)
        return send(response, 401, {error: count >= 5 ? 'Too many attempts — wait a minute.' : 'That password is not right.'})
      }
      failures.delete(client)
      return send(response, 200, {ok: true}, undefined, {'Set-Cookie': auth.signInCookie(host)})
    } catch (error) { return send(response, 400, {error: error.message}) }
  }

  if (url.pathname === '/api/logout' && method === 'POST') {
    return send(response, 200, {ok: true}, undefined, {'Set-Cookie': auth.signOutCookie(host)})
  }

  /* ---------- the guard ---------- */

  const isAdminFile = url.pathname === '/admin' || url.pathname.startsWith('/admin/')
  const guarded = url.pathname.startsWith('/api/') || (isAdminFile && !openPaths.has(url.pathname))
  if (guarded && !auth.signedIn(request)) {
    if (url.pathname.startsWith('/api/')) return send(response, 401, {error: 'Please sign in again'})
    response.writeHead(302, {Location: `/admin/login.html?next=${encodeURIComponent(url.pathname + url.search)}`})
    return response.end()
  }

  /* ---------- the console's data ---------- */

  if (url.pathname === '/api/pages' && method === 'GET') {
    return send(response, 200, await readPages({fresh: true}))
  }

  if (url.pathname === '/api/page' && method === 'POST') {
    try {
      const body = await readBody(request)
      const label = String(body.label || '').trim().replace(/\s+/g, ' ').slice(0, 70)
      const slug = String(body.slug || '').trim().toLowerCase()
      if (!label) return send(response, 400, {error: 'Please give the page a name'})
      if (!site.validSlug(slug)) {
        return send(response, 400, {error: 'The address may use lower-case letters, numbers and hyphens only'})
      }
      const pages = await readPages({fresh: true})
      if (site.slugTaken(slug, pages)) {
        return send(response, 409, {error: `"${slug}" is already in use — choose another address`})
      }

      const page = {id: slug, label, file: `${slug}/index.html`, path: `/${slug}/`}
      const description = String(body.description || '').trim().replace(/\s+/g, ' ').slice(0, 200)
      const intro = String(body.intro || '').trim().replace(/\s+/g, ' ').slice(0, 400)
      await store.writeText(store.pageKey(page.id), site.pageTemplate({
        label,
        description: description || `${label} — SPES COUNSELLING, trauma-informed counselling in Brisbane and via telehealth.`,
        intro: intro || 'Add the opening paragraph for this page here.',
      }), mime['.html'])

      await store.writeJson(store.PAGES, [...pages, page])
      const navAdded = body.addToNav === false ? false : await editShell('add', page)
      const sitemapAdded = await editSitemap('add', page.path)
      return send(response, 200, {page, navAdded, sitemapAdded})
    } catch (error) { return send(response, 400, {error: error.message}) }
  }

  if (url.pathname === '/api/page' && method === 'DELETE') {
    try {
      const pages = await readPages({fresh: true})
      const page = pages.find(item => item.id === url.searchParams.get('id'))
      if (!page) return send(response, 404, {error: 'Page not found'})
      if (page.locked) return send(response, 403, {error: 'The home page cannot be deleted'})
      await store.remove(store.pageKey(page.id))
      await store.writeJson(store.PAGES, pages.filter(item => item.id !== page.id))
      const navRemoved = await editShell('remove', page)
      const sitemapRemoved = await editSitemap('remove', page.path)
      return send(response, 200, {removed: page.id, navRemoved, sitemapRemoved})
    } catch (error) { return send(response, 500, {error: `Could not delete the page: ${error.message}`}) }
  }

  if (url.pathname === '/api/page' && method === 'GET') {
    const pages = await readPages({fresh: true})
    const page = pages.find(item => item.id === url.searchParams.get('id'))
    if (!page) return send(response, 404, {error: 'Page not found'})
    const html = await store.readText(store.pageKey(page.id), {fresh: true})
    if (html === null) return send(response, 500, {error: 'Unable to read page'})
    return send(response, 200, {html})
  }

  if (url.pathname === '/api/page' && method === 'PUT') {
    try {
      const body = await readBody(request)
      const pages = await readPages({fresh: true})
      const page = pages.find(item => item.id === body.id)
      if (!page || typeof body.html !== 'string' || !body.html.toLowerCase().includes('<html')) {
        return send(response, 400, {error: 'Invalid page content'})
      }
      await store.writeText(store.pageKey(page.id), body.html, mime['.html'])
      return send(response, 200, {ok: true})
    } catch (error) { return send(response, 400, {error: error.message}) }
  }

  if (url.pathname === '/api/media' && method === 'GET') {
    try {
      const [files, usage] = await Promise.all([store.listMedia(), mediaUsage()])
      return send(response, 200, files.map(file => ({...file, usedBy: usage.get(file.name) || []})))
    } catch { return send(response, 500, {error: 'Unable to load media'}) }
  }

  /* Only a file nothing shows may go. Deleting one that is still on a page
     would leave a broken picture on the live site with nothing to explain it,
     and the store has no undo — so the refusal names where it is still used and
     leaves replacing it to the editor. */
  if (url.pathname === '/api/media' && method === 'DELETE') {
    try {
      const name = String(url.searchParams.get('name') || '')
      if (!name || name.includes('/') || name.includes('..')) {
        return send(response, 400, {error: 'That is not a file this console can delete'})
      }
      const files = await store.listMedia()
      if (!files.some(file => file.name === name)) {
        return send(response, 404, {error: 'That file is no longer in the library'})
      }
      const usedBy = (await mediaUsage()).get(name) || []
      if (usedBy.length) {
        return send(response, 409, {error: `That file is still used by ${usedBy.join(', ')}. Replace it there first.`, usedBy})
      }
      await store.removeMedia(name)
      return send(response, 200, {removed: name})
    } catch (error) { return send(response, 500, {error: `Could not delete the file: ${error.message}`}) }
  }

  if (url.pathname === '/api/profile' && method === 'GET') {
    return send(response, 200, await readProfile({fresh: true}))
  }

  if (url.pathname === '/api/profile' && method === 'PUT') {
    try {
      const body = await readBody(request)
      const text = field => typeof body[field] === 'string' ? body[field].trim().replace(/\s+/g, ' ').slice(0, 300) : ''
      const profile = {name: text('name'), credential: text('credential'), role: text('role'), photo: text('photo')}
      if (!profile.name) return send(response, 400, {error: 'Please enter a name'})
      // Either an image already in the repo, or one this console uploaded to Blob.
      const repoAsset = /^\/assets\/[\w/-]+\.(png|jpe?g|webp|svg)$/i.test(profile.photo)
      const uploaded = /^\/media\/[\w.-]+$/.test(profile.photo)
      if (profile.photo && (profile.photo.includes('..') || !(repoAsset || uploaded))) {
        return send(response, 400, {error: 'Please upload the photo first'})
      }
      await store.writeJson(store.PROFILE, profile)
      return send(response, 200, profile)
    } catch (error) { return send(response, 400, {error: error.message}) }
  }

  /* Changing the password needs the current one as well as the session: a
     signed-in console left open should not be enough to lock its owner out. */
  if (url.pathname === '/api/password' && method === 'PUT') {
    try {
      const body = await readBody(request)
      const client = clientOf(request)
      const wait = lockedFor(client)
      if (wait) return send(response, 429, {error: `Too many attempts — wait ${wait} seconds.`})
      if (!await auth.passwordMatches(body.current || '')) {
        countFailure(client)
        // 403, not 401: the session is fine, it is the typing that was wrong,
        // and the console treats a 401 as a reason to send you back to sign in.
        return send(response, 403, {error: 'That is not your current password.'})
      }
      failures.delete(client)
      const complaint = auth.rejectPassword(body.next)
      if (complaint) return send(response, 400, {error: complaint})
      if (String(body.next) === String(body.current)) {
        return send(response, 400, {error: 'That is already your password.'})
      }
      await auth.setPassword(body.next)
      // The cookie is signed, not stored, so old ones stay valid until they
      // expire; a fresh one at least restarts the clock for whoever changed it.
      return send(response, 200, {ok: true}, undefined, {'Set-Cookie': auth.signInCookie(host)})
    } catch (error) { return send(response, 400, {error: error.message}) }
  }

  if (url.pathname === '/api/stats' && method === 'GET') {
    try {
      const pages = await readPages({fresh: true})
      const measured = await Promise.all(pages.map(async page => {
        const html = await store.readText(store.pageKey(page.id), {fresh: true})
        return html === null ? null : site.pageStats(page, html, Date.now())
      }))
      return send(response, 200, measured.filter(Boolean))
    } catch (error) { return send(response, 500, {error: `Unable to measure pages: ${error.message}`}) }
  }

  /* Hands back a URL the browser may PUT one file to, and the address that file
     will answer to afterwards. The bytes never come through here — which is the
     whole point, see signedPutUrl — so a phone photo or a video is limited by
     the store rather than by what a function may be handed. */
  if (url.pathname === '/api/upload-url' && method === 'POST') {
    try {
      const body = await readBody(request)
      const contentType = String(body.contentType || '').toLowerCase()
      const allowed = store.MEDIA_TYPES[contentType]
      if (!allowed) {
        const kinds = 'PNG, JPG, WebP, AVIF, GIF or SVG images, and MP4, WebM or MOV video'
        return send(response, 400, {error: `That file type cannot be uploaded. Please choose one of: ${kinds}.`})
      }
      const size = Number(body.size)
      const cap = store.MAX_BYTES[allowed.kind]
      if (!Number.isFinite(size) || size <= 0) return send(response, 400, {error: 'That file appears to be empty.'})
      if (size > cap) {
        return send(response, 400, {error: `That ${allowed.kind} is ${Math.round(size / 1048576)} MB. The limit is ${Math.round(cap / 1048576)} MB.`})
      }
      const name = store.mediaName(body.name, allowed.ext)
      return send(response, 200, {uploadUrl: await store.signedPutUrl(name, contentType), url: store.MEDIA_PATH + name, name})
    } catch (error) { return send(response, 500, {error: `Could not start the upload: ${error.message}`}) }
  }

  if (url.pathname === '/api/upload' && method === 'POST') {
    try {
      const body = await readBody(request)
      const match = typeof body.data === 'string' && body.data.match(/^data:image\/(png|jpe?g|webp|svg\+xml);base64,(.+)$/)
      if (!match) return send(response, 400, {error: 'Please choose a PNG, JPG, WebP or SVG image'})
      const contentType = `image/${match[1] === 'jpg' ? 'jpeg' : match[1]}`
      const safeName = store.mediaName(body.name, store.MEDIA_TYPES[contentType].ext)
      const uploaded = await store.putMedia(safeName, Buffer.from(match[2], 'base64'), contentType)
      return send(response, 200, {url: uploaded})
    } catch (error) { return send(response, 400, {error: error.message}) }
  }

  if (url.pathname.startsWith('/api/')) return send(response, 404, {error: 'No such endpoint'})

  /* ---------- the console's own files ----------
     Only the dev server gets this far: on Vercel these are static files the CDN
     has already served, which is why the guard above is a local nicety there
     rather than the thing protecting the console. The /api routes are. */

  if (isAdminFile) {
    const relative = url.pathname === '/admin' || url.pathname === '/admin/' ? 'admin/index.html' : url.pathname.slice(1)
    return sendFile(response, path.join(root, relative))
  }

  /* ---------- the published site ---------- */

  /* Addresses a page has outgrown. Kept so a link written before the rename
     still lands somewhere, and permanent so it is followed once and remembered. */
  const MOVED = {'/how-i-can-help/': '/my-services/', '/how-i-can-help': '/my-services/'}
  if (MOVED[url.pathname]) {
    response.writeHead(308, {Location: MOVED[url.pathname] + url.search})
    return response.end()
  }

  /* The images the console uploaded. They sit in a private store, so there is
     no blob URL for the browser to fetch and this is the only way to them. No
     sign-in guard: they are the site's own pictures, meant to be seen. */
  if (url.pathname.startsWith(store.MEDIA_PATH) && method === 'GET') {
    const name = decodeURIComponent(url.pathname.slice(store.MEDIA_PATH.length))
    if (!name || name.includes('/') || name.includes('..')) {
      return send(response, 404, 'Not found', 'text/plain; charset=utf-8')
    }
    /* Video is not answered from here. Reading it would mean holding the whole
       file in memory to send it in one piece, and a player seeking through a
       clip asks for byte ranges this path has no way to serve — so it would
       arrive slowly, cost the function its memory, and still not scrub. A
       short-lived signed URL sends the browser to the store's own CDN, which
       does ranges properly and never troubles the function again. */
    if (store.isVideo(name)) {
      try {
        const signed = await store.signedGetUrl(name, SIGNED_SECONDS)
        response.writeHead(302, {Location: signed, 'Cache-Control': VIDEO_REDIRECT_CACHE})
        return response.end()
      } catch { return send(response, 404, 'Not found', 'text/plain; charset=utf-8') }
    }

    const image = await store.readMedia(name)
    if (!image) return send(response, 404, 'Not found', 'text/plain; charset=utf-8')
    return send(response, 200, image.body, image.contentType, {
      'Cache-Control': MEDIA_CACHE,
      'X-Content-Type-Options': 'nosniff',
    })
  }

  /* Local development should show the files being edited in this project. The
     CMS remains the production fallback, but it must not shadow a local page
     while working on it. */
  if (process.env.SPES_SERVE_STATIC === '1') {
    let localPath = decodeURIComponent(url.pathname)
    if (!localPath || localPath === '/') localPath = '/index.html'
    else if (localPath.endsWith('/')) localPath += 'index.html'
    const localFile = path.resolve(root, `.${localPath}`)
    if (localFile.startsWith(root + path.sep) && fs.existsSync(localFile) && fs.statSync(localFile).isFile()) {
      return sendFile(response, localFile)
    }
  }

  if (url.pathname === '/shell.js' || url.pathname === '/sitemap.xml') {
    const shellWanted = url.pathname === '/shell.js'
    const text = await store.readText(shellWanted ? store.SHELL : store.SITEMAP)
    if (text === null) return send(response, 404, 'Not found', 'text/plain; charset=utf-8')
    return send(response, 200, text, shellWanted ? mime['.js'] : mime['.xml'], {'Cache-Control': PAGE_CACHE})
  }

  const pages = await readPages()
  const wanted = url.pathname.endsWith('/') ? url.pathname : `${url.pathname}/`
  const page = pages.find(item => item.path === wanted)
  if (page) {
    // /about -> /about/, so a page is only ever cached under one address.
    if (!url.pathname.endsWith('/')) {
      response.writeHead(308, {Location: wanted + url.search})
      return response.end()
    }
    const html = await store.readText(store.pageKey(page.id))
    if (html !== null) return send(response, 200, html, mime['.html'], {'Cache-Control': PAGE_CACHE})
  }

  /* ---------- the dev server's static files ----------
     In production these never reach here: Vercel's CDN serves the project's
     static files before the function is invoked. */

  if (process.env.SPES_SERVE_STATIC === '1') {
    let pathname = decodeURIComponent(url.pathname)
    if (!pathname || pathname === '/') pathname = '/index.html'
    else if (pathname.endsWith('/')) pathname += 'index.html'
    return sendFile(response, path.resolve(root, `.${pathname}`))
  }

  return send(response, 404, 'Not found', 'text/plain; charset=utf-8')
}
