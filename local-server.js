const http = require('http')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const root = __dirname

/* ---------- page registry ----------
   The seven original pages, then whatever the console has added since. Held in
   admin/pages.json so a new page survives a restart. */
const registryFile = path.join(root, 'admin', 'pages.json')
const seedPages = [
  {id: 'home', label: 'Home', file: 'index.html', path: '/', locked: true},
  {id: 'about', label: 'About', file: 'about/index.html', path: '/about/'},
  {id: 'help', label: 'How I Can Help', file: 'how-i-can-help/index.html', path: '/how-i-can-help/'},
  {id: 'approach', label: 'My Approach', file: 'approach/index.html', path: '/approach/'},
  {id: 'violence', label: 'Domestic & Family Violence', file: 'domestic-family-violence/index.html', path: '/domestic-family-violence/'},
  {id: 'contact', label: 'Contact', file: 'contact/index.html', path: '/contact/'},
  {id: 'privacy', label: 'Privacy Policy', file: 'privacy/index.html', path: '/privacy/'},
]

function readPages() {
  try {
    const saved = JSON.parse(fs.readFileSync(registryFile, 'utf8'))
    if (Array.isArray(saved) && saved.length) return saved
  } catch { /* fall through to the seed */ }
  return seedPages
}

function writePages(list) {
  fs.writeFileSync(registryFile, JSON.stringify(list, null, 2) + '\n')
}

let pages = readPages()
const findPage = id => pages.find(page => page.id === id)
const mime = {'.css':'text/css; charset=utf-8','.html':'text/html; charset=utf-8','.ico':'image/x-icon','.jpeg':'image/jpeg','.jpg':'image/jpeg','.js':'text/javascript; charset=utf-8','.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.webp':'image/webp','.xml':'application/xml'}

function send(response, status, data, type = 'application/json; charset=utf-8') {
  response.writeHead(status, {'Content-Type': type})
  response.end(Buffer.isBuffer(data) || typeof data === 'string' ? data : JSON.stringify(data))
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = ''
    request.on('data', chunk => { body += chunk; if (body.length > 8 * 1024 * 1024) reject(new Error('Request is too large')) })
    request.on('end', () => { try { resolve(JSON.parse(body || '{}')) } catch { reject(new Error('Invalid request data')) } })
  })
}

/* ---------- sign-in ----------
   The password is stored as a scrypt hash in admin/auth.json (gitignored), never
   in this file. Set SPES_ADMIN_PASSWORD before the first run to choose your own;
   delete auth.json to reset it. Sessions live in memory, so restarting signs out. */
const authFile = path.join(root, 'admin', 'auth.json')
const SESSION_MS = 8 * 60 * 60 * 1000
const sessions = new Map()
const failures = new Map()

function writeAuth(password) {
  const salt = crypto.randomBytes(16).toString('hex')
  const auth = {salt, hash: crypto.scryptSync(password, salt, 64).toString('hex')}
  fs.writeFileSync(authFile, JSON.stringify(auth, null, 2) + '\n')
  return auth
}

const auth = (() => {
  try { return JSON.parse(fs.readFileSync(authFile, 'utf8')) }
  catch { return writeAuth(process.env.SPES_ADMIN_PASSWORD || 'hello123') }
})()

function passwordMatches(password) {
  const candidate = crypto.scryptSync(String(password), auth.salt, 64)
  const stored = Buffer.from(auth.hash, 'hex')
  return candidate.length === stored.length && crypto.timingSafeEqual(candidate, stored)
}

function sessionToken(request) {
  return (/(?:^|;\s*)spes_session=([a-f0-9]{64})/.exec(request.headers.cookie || '') || [])[1]
}

function signedIn(request) {
  const token = sessionToken(request)
  if (!token) return false
  const expires = sessions.get(token)
  if (!expires) return false
  if (expires < Date.now()) { sessions.delete(token); return false }
  return true
}

function sendWithCookie(response, status, body, cookie) {
  response.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Set-Cookie': cookie})
  response.end(JSON.stringify(body))
}

const profileFile = path.join(root, 'admin', 'profile.json')
const defaultProfile = {name: 'Lisa Chiarini', credential: 'ACA Registered Counsellor', role: 'Site administrator', photo: ''}

function readProfile() {
  try { return {...defaultProfile, ...JSON.parse(fs.readFileSync(profileFile, 'utf8'))} }
  catch { return {...defaultProfile} }
}

/* ---------- creating and removing pages ---------- */
const RESERVED = new Set(['admin', 'api', 'assets', 'static', 'vendor', 'node_modules', 'index.html', 'favicon.ico'])

function slugTaken(slug) {
  if (RESERVED.has(slug)) return true
  if (pages.some(page => page.id === slug || page.path === `/${slug}/`)) return true
  return fs.existsSync(path.join(root, slug))
}

const escapeHtml = value => String(value).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]))
// Titles are stored HTML-escaped; report them the way a reader sees them.
const decodeHtml = value => String(value).replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, m => ({'&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&nbsp;': ' '}[m]))

function pageTemplate({label, description, intro}) {
  return `<!doctype html>
<html lang="en-AU">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <!-- REMOVE AT LAUNCH: noindex guard -->
  <meta name="robots" content="noindex, nofollow">
  <title>${escapeHtml(label)} | SPES COUNSELLING</title>
  <meta name="description" content="${escapeHtml(description)}">
  <link rel="stylesheet" href="../styles.css?v=plum-fix">
  <script src="../shell.js"></script>
</head>
<body>
  <site-header></site-header>
  <main id="main">
    <section class="page-hero">
      <div class="container prose">
        <h1>${escapeHtml(label)}</h1>
        <p>${escapeHtml(intro)}</p>
      </div>
    </section>
    <section class="section surface">
      <div class="container prose page-copy">
        <h2>About this page</h2>
        <p>Replace this paragraph with your own words. Open this page in the console editor to change the heading, the text above and the search listing.</p>
        <a class="button" href="{{HALAXY_URL}}">Book an appointment</a>
      </div>
    </section>
  </main>
  <site-footer></site-footer>
</body>
</html>
`
}

/* The whole site's navigation lives in shell.js, so one edit covers every page. */
function updateNavigation(action, {label, path: href}) {
  const shellPath = path.join(root, 'shell.js')
  let shell
  try { shell = fs.readFileSync(shellPath, 'utf8') } catch { return false }

  const headerAnchor = '<a class="button" href="{{HALAXY_URL}}">Book an appointment</a>'
  const footerAnchor = '<a href="/privacy/">Privacy Policy</a>'
  const link = `<a href="${href}">${label}</a>`

  if (action === 'add') {
    if (shell.includes(link) || !shell.includes(headerAnchor) || !shell.includes(footerAnchor)) return false
    shell = shell.replace(headerAnchor, link + headerAnchor).replace(footerAnchor, link + footerAnchor)
  } else {
    if (!shell.includes(link)) return false
    shell = shell.split(link).join('')
  }
  fs.writeFileSync(shellPath, shell)
  return true
}

function updateSitemap(action, href) {
  const sitemapPath = path.join(root, 'sitemap.xml')
  let xml
  try { xml = fs.readFileSync(sitemapPath, 'utf8') } catch { return false }
  const entry = `<url><loc>https://www.spescounselling.com.au${href}</loc></url>`
  if (action === 'add') {
    if (xml.includes(entry)) return false
    xml = xml.replace('</urlset>', entry + '</urlset>')
  } else {
    if (!xml.includes(entry)) return false
    xml = xml.split(entry).join('')
  }
  fs.writeFileSync(sitemapPath, xml)
  return true
}

function pageStats({id, label, file, path: href, locked}) {
  const full = path.join(root, file)
  const html = fs.readFileSync(full, 'utf8')
  const main = (html.match(/<main[\s\S]*?<\/main>/i) || [html])[0]
  const images = main.match(/<img\b[^>]*>/gi) || []
  const text = main.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ')
  return {
    id,
    label,
    file,
    path: href,
    locked: Boolean(locked),
    title: decodeHtml((html.match(/<title>([\s\S]*?)<\/title>/i) || ['', ''])[1].trim()),
    description: decodeHtml((html.match(/<meta[^>]+name="description"[^>]+content="([^"]*)"/i) || ['', ''])[1].trim()),
    words: text.split(/\s+/).filter(Boolean).length,
    h1: (main.match(/<h1\b/gi) || []).length,
    headings: (main.match(/<h[1-3]\b/gi) || []).length,
    paragraphs: (main.match(/<p\b/gi) || []).length,
    links: (main.match(/<a\b/gi) || []).length,
    images: images.length,
    // An empty alt="" is the correct marking for a decorative image, so only a
    // missing attribute counts as a fault.
    imagesWithoutAlt: images.filter(tag => !/\salt\s*=/i.test(tag)).length,
    bytes: Buffer.byteLength(html),
    modified: fs.statSync(full).mtimeMs,
    indexed: !/noindex/i.test(html),
  }
}

function listMedia(folder, publicPath = '/assets') {
  return fs.readdirSync(folder, {withFileTypes: true}).flatMap(entry => {
    const file = path.join(folder, entry.name)
    const url = `${publicPath}/${entry.name}`
    if (entry.isDirectory()) return listMedia(file, url)
    if (!/\.(png|jpe?g|webp|svg)$/i.test(entry.name)) return []
    return [{name: entry.name, url, bytes: fs.statSync(file).size}]
  })
}

// Everything the sign-in page itself needs, before any session exists.
const openPaths = new Set(['/admin/login.html', '/admin/login.js', '/admin/app.css', '/admin/favicon.ico'])

http.createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost')

  if (url.pathname === '/api/login' && request.method === 'POST') {
    const client = request.socket.remoteAddress || 'unknown'
    const locked = failures.get(client)
    if (locked && locked.until > Date.now()) {
      return send(response, 429, {error: `Too many attempts — wait ${Math.ceil((locked.until - Date.now()) / 1000)} seconds.`})
    }
    try {
      const {password} = await readBody(request)
      if (!passwordMatches(password || '')) {
        const count = (locked ? locked.count : 0) + 1
        failures.set(client, {count, until: count >= 5 ? Date.now() + 60000 : 0})
        return send(response, 401, {error: count >= 5 ? 'Too many attempts — wait a minute.' : 'That password is not right.'})
      }
      failures.delete(client)
      const token = crypto.randomBytes(32).toString('hex')
      sessions.set(token, Date.now() + SESSION_MS)
      return sendWithCookie(response, 200, {ok: true}, `spes_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}`)
    } catch (error) { return send(response, 400, {error: error.message}) }
  }

  if (url.pathname === '/api/logout' && request.method === 'POST') {
    sessions.delete(sessionToken(request))
    return sendWithCookie(response, 200, {ok: true}, 'spes_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0')
  }

  // The public website stays open; the console and its data do not.
  const guarded = url.pathname.startsWith('/api/') || (url.pathname.startsWith('/admin') && !openPaths.has(url.pathname))
  if (guarded && !signedIn(request)) {
    if (url.pathname.startsWith('/api/')) return send(response, 401, {error: 'Please sign in again'})
    response.writeHead(302, {Location: `/admin/login.html?next=${encodeURIComponent(url.pathname + url.search)}`})
    return response.end()
  }

  if (url.pathname === '/api/pages') return send(response, 200, pages)

  if (url.pathname === '/api/page' && request.method === 'POST') {
    try {
      const body = await readBody(request)
      const label = String(body.label || '').trim().replace(/\s+/g, ' ').slice(0, 70)
      const slug = String(body.slug || '').trim().toLowerCase()
      if (!label) return send(response, 400, {error: 'Please give the page a name'})
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 60) {
        return send(response, 400, {error: 'The address may use lower-case letters, numbers and hyphens only'})
      }
      if (slugTaken(slug)) return send(response, 409, {error: `“${slug}” is already in use — choose another address`})

      const page = {id: slug, label, file: `${slug}/index.html`, path: `/${slug}/`}
      const description = String(body.description || '').trim().replace(/\s+/g, ' ').slice(0, 200)
      const intro = String(body.intro || '').trim().replace(/\s+/g, ' ').slice(0, 400)
      fs.mkdirSync(path.join(root, slug), {recursive: true})
      fs.writeFileSync(path.join(root, page.file), pageTemplate({
        label,
        description: description || `${label} — SPES COUNSELLING, trauma-informed counselling in Brisbane and via telehealth.`,
        intro: intro || 'Add the opening paragraph for this page here.',
      }))

      pages = [...pages, page]
      writePages(pages)
      const navAdded = body.addToNav === false ? false : updateNavigation('add', page)
      const sitemapAdded = updateSitemap('add', page.path)
      return send(response, 200, {page, navAdded, sitemapAdded})
    } catch (error) { return send(response, 400, {error: error.message}) }
  }

  if (url.pathname === '/api/page' && request.method === 'DELETE') {
    const page = findPage(url.searchParams.get('id'))
    if (!page) return send(response, 404, {error: 'Page not found'})
    if (page.locked) return send(response, 403, {error: 'The home page cannot be deleted'})
    const file = path.resolve(root, page.file)
    const folder = path.dirname(file)
    // Refuse anything that would reach outside the project or take out the root.
    if (!file.startsWith(root + path.sep) || folder === root) return send(response, 400, {error: 'That page cannot be deleted safely'})
    try {
      fs.rmSync(file, {force: true})
      if (fs.readdirSync(folder).length === 0) fs.rmdirSync(folder)
      pages = pages.filter(item => item.id !== page.id)
      writePages(pages)
      const navRemoved = updateNavigation('remove', page)
      const sitemapRemoved = updateSitemap('remove', page.path)
      return send(response, 200, {removed: page.id, navRemoved, sitemapRemoved})
    } catch (error) { return send(response, 500, {error: `Could not delete the page: ${error.message}`}) }
  }
  if (url.pathname === '/api/media') {
    try { return send(response, 200, listMedia(path.join(root, 'assets'))) }
    catch { return send(response, 500, {error: 'Unable to load media'}) }
  }
  if (url.pathname === '/api/profile' && request.method === 'GET') return send(response, 200, readProfile())
  if (url.pathname === '/api/profile' && request.method === 'PUT') {
    try {
      const body = await readBody(request)
      const text = field => typeof body[field] === 'string' ? body[field].trim().replace(/\s+/g, ' ').slice(0, 120) : ''
      const profile = {name: text('name'), credential: text('credential'), role: text('role'), photo: text('photo')}
      if (!profile.name) return send(response, 400, {error: 'Please enter a name'})
      // Only an already-uploaded local asset may be referenced — no remote URL, no traversal.
      if (profile.photo && (profile.photo.includes('..') || !/^\/assets\/[\w/-]+\.(png|jpe?g|webp|svg)$/i.test(profile.photo))) {
        return send(response, 400, {error: 'Please upload the photo first'})
      }
      fs.writeFileSync(profileFile, JSON.stringify(profile, null, 2) + '\n')
      return send(response, 200, profile)
    } catch (error) { return send(response, 400, {error: error.message}) }
  }
  if (url.pathname === '/api/stats') {
    try { return send(response, 200, pages.map(pageStats)) }
    catch (error) { return send(response, 500, {error: `Unable to measure pages: ${error.message}`}) }
  }
  if (url.pathname === '/api/page' && request.method === 'GET') {
    const page = findPage(url.searchParams.get('id'))
    if (!page) return send(response, 404, {error: 'Page not found'})
    return fs.readFile(path.join(root, page.file), 'utf8', (error, html) => error ? send(response, 500, {error: 'Unable to read page'}) : send(response, 200, {html}))
  }
  if (url.pathname === '/api/page' && request.method === 'PUT') {
    try {
      const {id, html} = await readBody(request)
      const page = findPage(id)
      if (!page || typeof html !== 'string' || !html.toLowerCase().includes('<html')) return send(response, 400, {error: 'Invalid page content'})
      fs.writeFile(path.join(root, page.file), html, 'utf8', error => error ? send(response, 500, {error: 'Save failed'}) : send(response, 200, {ok: true}))
    } catch (error) { return send(response, 400, {error: error.message}) }
    return
  }
  if (url.pathname === '/api/upload' && request.method === 'POST') {
    try {
      const {name, data} = await readBody(request)
      const match = typeof data === 'string' && data.match(/^data:image\/(png|jpe?g|webp|svg\+xml);base64,(.+)$/)
      if (!match) return send(response, 400, {error: 'Please choose a PNG, JPG, WebP or SVG image'})
      const safeName = `${Date.now()}-${String(name || 'image').replace(/[^a-z0-9.-]/gi, '-').toLowerCase()}`
      const folder = path.join(root, 'assets', 'uploads')
      fs.mkdirSync(folder, {recursive: true})
      fs.writeFileSync(path.join(folder, safeName), Buffer.from(match[2], 'base64'))
      return send(response, 200, {url: `/assets/uploads/${safeName}`})
    } catch (error) { return send(response, 400, {error: error.message}) }
  }

  let pathname = decodeURIComponent(url.pathname)
  if (!pathname || pathname === '/') pathname = '/index.html'
  else if (pathname === '/admin' || pathname === '/admin/') pathname = '/admin/index.html'
  else if (pathname.endsWith('/')) pathname += 'index.html'
  const file = path.resolve(root, `.${pathname}`)
  if (!file.startsWith(root)) return send(response, 403, 'Forbidden', 'text/plain')
  fs.readFile(file, (error, data) => error ? send(response, 404, 'Not found', 'text/plain') : send(response, 200, data, mime[path.extname(file)] || 'application/octet-stream'))
}).listen(8000, '127.0.0.1', () => console.log('SPES local CMS: http://127.0.0.1:8000'))
