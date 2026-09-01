/* Exercises lib/handler.js against an in-memory stand-in for Vercel Blob, so the
   whole console can be checked without a real store or a token. */

const Module = require('module')
const path = require('path')

const project = path.join(__dirname, '..')
const memory = new Map()

/* The real store is private, and a private store refuses access: 'public'
   outright — asking for it is how image uploads broke once, with the store's
   own error surfacing in the console. So the stand-in refuses it too. */
function privateOnly(method, options) {
  if (!options || !options.access) throw new Error(`${method}() needs an access option`)
  if (options.access !== 'private') {
    throw new Error('Vercel Blob: Cannot use public access on a private store. The store is configured with private access.')
  }
}

const fakeBlob = {
  async put(pathname, body, options) {
    privateOnly('put', options)
    if (memory.has(pathname) && !options.allowOverwrite) throw new Error('blob already exists')
    memory.set(pathname, {
      body: Buffer.isBuffer(body) ? body : Buffer.from(String(body)),
      access: options.access,
      contentType: options.contentType,
    })
    return {pathname, url: `https://fake123.private.blob.vercel-storage.com/${pathname}`}
  },
  async get(pathname, options) {
    privateOnly('get', options)
    const found = memory.get(pathname)
    if (!found) return null
    return {
      statusCode: 200,
      stream: new Response(found.body).body,
      headers: new Headers(),
      blob: {contentType: found.contentType},
    }
  },
  async list(options) {
    const prefix = (options && options.prefix) || ''
    return {
      blobs: [...memory.entries()]
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, value]) => ({pathname: key, url: `https://fake123.private.blob.vercel-storage.com/${key}`, size: value.body.length})),
    }
  },
  async del(pathname) { memory.delete(pathname) },

  /* Signing a URL for the browser to upload to. The stand-in cannot take a real
     PUT, so a test writes through put() where a browser would send bytes; what
     is worth checking here is that the handler asks for the right scope. */
  async issueSignedToken(options) {
    if (!options || !options.pathname) throw new Error('issueSignedToken() needs a pathname')
    return {
      delegationToken: `fake-delegation:${options.pathname}`,
      clientSigningToken: 'fake-signing',
      validUntil: options.validUntil || Date.now() + 3600 * 1000,
      scope: options,
    }
  },

  /* The real presignUrl builds `<store>.<access>.blob.vercel-storage.com`, and
     when `access` is left out the hostname comes back with the word `undefined`
     in it and resolves nowhere — the SDK's own types omit the field on the
     get-shaped options, so it is easy to lose. The stand-in refuses it the way
     privateOnly() refuses a missing access, so it cannot be lost again quietly. */
  async presignUrl(issued, options) {
    if (!issued || !issued.delegationToken) throw new Error('presignUrl() needs an issued token')
    if (options.operation === 'get' && options.access !== 'private') {
      throw new Error("presignUrl() on a private store needs access: 'private'")
    }
    return {presignedUrl: `https://fake123.private.blob.vercel-storage.com/${options.pathname}?vercel-blob-signature=fake`}
  },
}

const load = Module._load
Module._load = function (request, ...rest) {
  if (request === '@vercel/blob') return fakeBlob
  return load.call(this, request, ...rest)
}

process.env.BLOB_READ_WRITE_TOKEN = 'fake-token'
process.env.SPES_ADMIN_PASSWORD = 'correct-horse-battery'
process.env.SESSION_SECRET = 'a'.repeat(64)
process.env.SPES_SERVE_STATIC = '1'

const handler = require(path.join(project, 'lib', 'handler.js'))
const site = require(path.join(project, 'lib', 'site.js'))
const store = require(path.join(project, 'lib', 'store.js'))

function call(method, url, {body, cookie} = {}) {
  return new Promise(resolve => {
    const request = {
      method,
      url,
      headers: {host: '127.0.0.1:8000', ...(cookie ? {cookie} : {})},
      socket: {remoteAddress: '127.0.0.1'},
      body,
    }
    const chunks = []
    const response = {
      headersSent: false,
      statusCode: 0,
      headers: {},
      writeHead(status, headers) { this.statusCode = status; this.headers = headers || {}; this.headersSent = true },
      end(data) {
        if (data) chunks.push(Buffer.isBuffer(data) ? data : Buffer.from(String(data)))
        const text = Buffer.concat(chunks).toString()
        let json = null
        try { json = JSON.parse(text) } catch { /* not json */ }
        resolve({status: this.statusCode, headers: this.headers, text, json})
      },
    }
    Promise.resolve(handler(request, response)).catch(error => resolve({status: 0, text: `THREW: ${error.stack}`, json: null}))
  })
}

let passed = 0, failed = 0
function check(label, condition, detail) {
  if (condition) { passed++; console.log(`  ok    ${label}`) }
  else { failed++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}

async function main() {
  // Seed the store the way scripts/seed-blob.js does.
  await store.writeJson(store.PAGES, site.seedPages)
  for (const page of site.seedPages) {
    await store.writeText(store.pageKey(page.id), `<!doctype html><html><head><title>${page.label}</title></head><body><main><h1>${page.label}</h1><p>Body copy.</p></main></body></html>`, 'text/html; charset=utf-8')
  }
  const fs = require('fs')
  await store.writeText(store.SHELL, fs.readFileSync(path.join(project, 'shell.js'), 'utf8'), 'text/javascript')
  await store.writeText(store.SITEMAP, fs.readFileSync(path.join(project, 'sitemap.xml'), 'utf8'), 'application/xml')

  console.log('\nThe guard')
  check('/api/pages refused without a session', (await call('GET', '/api/pages')).status === 401)
  check('/admin/ redirects to sign-in', (await call('GET', '/admin/')).status === 302)
  check('the sign-in page itself is open', (await call('GET', '/admin/login.html')).status === 200)
  check('/admin/app.js refused without a session', (await call('GET', '/admin/app.js')).status === 302)

  console.log('\nSigning in')
  const wrong = await call('POST', '/api/login', {body: {password: 'guess'}})
  check('a wrong password is refused', wrong.status === 401, `got ${wrong.status}`)
  const right = await call('POST', '/api/login', {body: {password: 'correct-horse-battery'}})
  check('the right password is accepted', right.status === 200, right.text)
  const setCookie = right.headers['Set-Cookie'] || ''
  check('a session cookie comes back', /spes_session=1\./.test(setCookie), setCookie)
  check('the cookie is HttpOnly', /HttpOnly/.test(setCookie))
  const cookie = setCookie.split(';')[0]

  console.log('\nReading the site through the console')
  const pages = await call('GET', '/api/pages', {cookie})
  check('/api/pages lists every configured page', pages.status === 200 && pages.json.length === site.seedPages.length, pages.text.slice(0, 120))
  check('/admin/app.js is served once signed in', (await call('GET', '/admin/app.js', {cookie})).status === 200)
  const one = await call('GET', '/api/page?id=about', {cookie})
  check('/api/page returns the HTML', one.status === 200 && one.json.html.includes('<h1>About</h1>'), one.text.slice(0, 120))
  const stats = await call('GET', '/api/stats', {cookie})
  check('/api/stats measures every configured page', stats.status === 200 && stats.json.length === site.seedPages.length, stats.text.slice(0, 120))
  check('stats carry a word count', stats.status === 200 && stats.json[0].words > 0)

  console.log('\nEditing a page')
  const edited = '<!doctype html><html><head><title>About</title></head><body><main><h1>About Lisa</h1><p>New words.</p></main></body></html>'
  const save = await call('PUT', '/api/page', {cookie, body: {id: 'about', html: edited}})
  check('a save is accepted', save.status === 200, save.text)
  const reread = await call('GET', '/api/page?id=about', {cookie})
  check('the save is what comes back', reread.json.html === edited)
  const junk = await call('PUT', '/api/page', {cookie, body: {id: 'about', html: 'not html'}})
  check('content that is not a page is refused', junk.status === 400)

  console.log('\nCreating and removing a page')
  const created = await call('POST', '/api/page', {cookie, body: {label: 'Fees and Rebates', slug: 'fees'}})
  check('a page is created', created.status === 200, created.text)
  check('it was added to the navigation', created.json.navAdded === true)
  check('it was added to the sitemap', created.json.sitemapAdded === true)
  check('the navigation really changed', (await store.readText(store.SHELL)).includes('<a href="/fees/">Fees and Rebates</a>'))
  check('the new page is now listed', (await call('GET', '/api/pages', {cookie})).json.length === site.seedPages.length + 1)
  const clash = await call('POST', '/api/page', {cookie, body: {label: 'Again', slug: 'fees'}})
  check('a duplicate address is refused', clash.status === 409, clash.text)
  const bad = await call('POST', '/api/page', {cookie, body: {label: 'Bad', slug: 'Not A Slug'}})
  check('a malformed address is refused', bad.status === 400)
  const reserved = await call('POST', '/api/page', {cookie, body: {label: 'Nope', slug: 'admin'}})
  check('a reserved address is refused', reserved.status === 409, reserved.text)

  console.log('\nThe published site')
  // Static files are intentionally preferred while developing locally. Turn
  // that preference off for these checks so they exercise Vercel production's
  // Blob-backed route, then restore it for the static-asset check below.
  delete process.env.SPES_SERVE_STATIC
  const home = await call('GET', '/')
  check('the home page is served from the store', home.status === 200 && home.text.includes('<h1>Home</h1>'), home.text.slice(0, 120))
  check('the home page is cached briefly', /s-maxage=5\b/.test(home.headers['Cache-Control'] || ''), home.headers['Cache-Control'])
  // The grace period is what made a saved page keep serving its old text.
  check('no stale-while-revalidate on pages', !/stale-while-revalidate/.test(home.headers['Cache-Control'] || ''), home.headers['Cache-Control'])
  const newPage = await call('GET', '/fees/')
  check('the page just created is live', newPage.status === 200 && newPage.text.includes('Fees and Rebates'), newPage.text.slice(0, 160))
  check('a missing trailing slash redirects', (await call('GET', '/fees')).status === 308)
  check('the navigation is served', (await call('GET', '/shell.js')).status === 200)
  check('the sitemap is served', (await call('GET', '/sitemap.xml')).status === 200)
  check('the sitemap gained the new page', (await call('GET', '/sitemap.xml')).text.includes('/fees/'))
  process.env.SPES_SERVE_STATIC = '1'
  check('the stylesheet still comes off disk', (await call('GET', '/styles.css')).status === 200)
  check('an unknown address is a 404', (await call('GET', '/no-such-page/')).status === 404)

  console.log('\nImages')
  const png = 'data:image/png;base64,' + Buffer.from('fake png bytes').toString('base64')
  const upload = await call('POST', '/api/upload', {cookie, body: {name: 'Lisa Photo.PNG', data: png}})
  check('an image uploads', upload.status === 200 && typeof upload.json.url === 'string', upload.text)
  // A private store has no browser-reachable URL, so an upload is addressed by
  // this site rather than by Blob.
  check('it is addressed on this site', /^\/media\/\d+-lisa-photo\.png$/.test(upload.json.url || ''), upload.json.url)
  const notImage = await call('POST', '/api/upload', {cookie, body: {name: 'x.exe', data: 'data:application/x-msdownload;base64,AAAA'}})
  check('a non-image is refused', notImage.status === 400)
  const media = await call('GET', '/api/media', {cookie})
  check('the library lists the upload', media.status === 200 && media.json.length === 1, media.text)

  const served = await call('GET', upload.json.url)
  check('the image is served to the browser', served.status === 200 && served.text === 'fake png bytes', served.text.slice(0, 80))
  check('and served as the image it is', served.headers['Content-Type'] === 'image/png', served.headers['Content-Type'])
  // The name carries its upload time and is never reused, so nothing goes stale.
  check('and cached hard', /immutable/.test(served.headers['Cache-Control'] || ''), served.headers['Cache-Control'])
  check('signing out does not hide the images', (await call('GET', upload.json.url)).status === 200)
  check('a missing image is a 404', (await call('GET', '/media/no-such-image.png')).status === 404)
  check('an image cannot be escaped from', (await call('GET', '/media/..%2Fsite%2Fpages.json')).status === 404)

  /* The bytes used to travel through the function as base64 inside JSON, which
     a Vercel function caps at 4.5 MB of request body — so anything much past
     3 MB of actual picture failed, and video was hopeless. These check the
     ceiling is now the store's rather than the platform's. */
  console.log('\nLarge files and video')
  const ticket = await call('POST', '/api/upload-url', {cookie, body: {name: 'Session Room.JPEG', contentType: 'image/jpeg', size: 9 * 1024 * 1024}})
  check('a 9 MB photo is allowed', ticket.status === 200, ticket.text)
  check('the browser is told where to send it', typeof (ticket.json || {}).uploadUrl === 'string', ticket.text)
  check('and what it will answer to here', /^\/media\/\d+-session-room\.jpg$/.test((ticket.json || {}).url || ''), (ticket.json || {}).url)

  const clip = await call('POST', '/api/upload-url', {cookie, body: {name: 'Welcome Clip.MOV', contentType: 'video/quicktime', size: 120 * 1024 * 1024}})
  check('a 120 MB video is allowed', clip.status === 200, clip.text)
  check('a .mov is addressed as one', /^\/media\/\d+-welcome-clip\.mov$/.test((clip.json || {}).url || ''), (clip.json || {}).url)

  check('but not past the video limit', (await call('POST', '/api/upload-url', {cookie, body: {name: 'huge.mp4', contentType: 'video/mp4', size: 900 * 1024 * 1024}})).status === 400)
  check('nor past the picture limit', (await call('POST', '/api/upload-url', {cookie, body: {name: 'huge.png', contentType: 'image/png', size: 100 * 1024 * 1024}})).status === 400)
  check('nor a type the site cannot use', (await call('POST', '/api/upload-url', {cookie, body: {name: 'x.exe', contentType: 'application/x-msdownload', size: 64}})).status === 400)
  check('nor an empty file', (await call('POST', '/api/upload-url', {cookie, body: {name: 'x.png', contentType: 'image/png', size: 0}})).status === 400)
  check('and a ticket needs a session', (await call('POST', '/api/upload-url', {body: {name: 'a.png', contentType: 'image/png', size: 64}})).status === 401)

  // Where the browser would PUT to the signed URL, the test writes directly.
  await store.putMedia(clip.json.name, Buffer.from('fake mp4 bytes'), 'video/quicktime')
  const play = await call('GET', clip.json.url)
  check('video is answered with a redirect, not the bytes', play.status === 302, `${play.status} ${play.text.slice(0, 60)}`)
  check('the redirect points into the store', /blob\.vercel-storage\.com/.test(play.headers.Location || ''), play.headers.Location)
  // The signature lasts an hour; nothing may hold the redirect anywhere near it.
  check('and is cached for well under the signature', /max-age=300/.test(play.headers['Cache-Control'] || ''), play.headers['Cache-Control'])

  const withVideo = await call('GET', '/api/media', {cookie})
  const clipRow = (withVideo.json || []).find(item => item.name === clip.json.name)
  check('the library knows it is video', Boolean(clipRow) && clipRow.kind === 'video', JSON.stringify(clipRow))
  const photoRow = (withVideo.json || []).find(item => /\.png$/.test(item.name))
  check('and that a picture is not', Boolean(photoRow) && photoRow.kind === 'image', JSON.stringify(photoRow))

  /* The library is the only place an upload can be taken back out of the store,
     so what it must never do is take one a live page is still showing. */
  console.log('\nTidying the library')
  const pngName = String(upload.json.url || '').split('/').pop()
  const idle = await call('GET', '/api/media', {cookie})
  const idleRow = (idle.json || []).find(item => item.name === pngName)
  check('a file no page points at is reported unused', Boolean(idleRow) && idleRow.usedBy.length === 0, JSON.stringify(idleRow))

  const showing = `<!doctype html><html><head><title>About</title></head><body><main><h1>About Lisa</h1><img src="${upload.json.url}" alt=""></main></body></html>`
  await call('PUT', '/api/page', {cookie, body: {id: 'about', html: showing}})
  const busy = await call('GET', '/api/media', {cookie})
  const busyRow = (busy.json || []).find(item => item.name === pngName)
  check('and reported against the page that shows it', Boolean(busyRow) && busyRow.usedBy.includes('About'), JSON.stringify(busyRow))

  const refused = await call('DELETE', `/api/media?name=${pngName}`, {cookie})
  check('deleting a file a page still uses is refused', refused.status === 409, refused.text)
  check('and the file is still served', (await call('GET', upload.json.url)).status === 200)

  await call('PUT', '/api/page', {cookie, body: {id: 'about', html: edited}})
  const gone = await call('DELETE', `/api/media?name=${pngName}`, {cookie})
  check('deleting an unused file works', gone.status === 200, gone.text)
  check('the library stops listing it', !((await call('GET', '/api/media', {cookie})).json || []).some(item => item.name === pngName))
  check('and the site stops serving it', (await call('GET', upload.json.url)).status === 404)
  check('deleting it again is a 404', (await call('DELETE', `/api/media?name=${pngName}`, {cookie})).status === 404)
  check('a name cannot escape the media folder', (await call('DELETE', '/api/media?name=..%2Fsite%2Fpages.json', {cookie})).status === 400)
  check('and a deletion needs a session', (await call('DELETE', `/api/media?name=${clip.json.name}`)).status === 401)
  check('the video survived all that', (await call('GET', '/api/media', {cookie})).json.some(item => item.name === clip.json.name))

  console.log('\nProfile')
  const profile = await call('PUT', '/api/profile', {cookie, body: {name: 'Lisa Chiarini', credential: 'ACA', role: 'Admin', photo: upload.json.url}})
  check('the profile saves with an uploaded photo', profile.status === 200, profile.text)
  const remote = await call('PUT', '/api/profile', {cookie, body: {name: 'Lisa', photo: 'https://evil.example.com/x.png'}})
  check('a photo from elsewhere is refused', remote.status === 400)
  const nameless = await call('PUT', '/api/profile', {cookie, body: {name: '', photo: ''}})
  check('an empty name is refused', nameless.status === 400)
  check('the profile reads back', (await call('GET', '/api/profile', {cookie})).json.name === 'Lisa Chiarini')

  console.log('\nDeleting')
  const removed = await call('DELETE', '/api/page?id=fees', {cookie})
  check('the page is deleted', removed.status === 200, removed.text)
  check('it left the navigation', !(await store.readText(store.SHELL)).includes('/fees/'))
  check('it left the sitemap', !(await call('GET', '/sitemap.xml')).text.includes('/fees/'))
  check('it is gone from the site', (await call('GET', '/fees/')).status === 404)
  const home2 = await call('DELETE', '/api/page?id=home', {cookie})
  check('the home page cannot be deleted', home2.status === 403, home2.text)

  console.log('\nChanging the password')
  const stale = await call('PUT', '/api/password', {cookie, body: {current: 'not-it', next: 'a-much-longer-one'}})
  check('the wrong current password is refused', stale.status === 403, stale.text)
  check('and that refusal is not a signed-out 401', stale.status !== 401)
  const short = await call('PUT', '/api/password', {cookie, body: {current: 'correct-horse-battery', next: 'short'}})
  check('a too-short new password is refused', short.status === 400, short.text)
  const same = await call('PUT', '/api/password', {cookie, body: {current: 'correct-horse-battery', next: 'correct-horse-battery'}})
  check('reusing the same password is refused', same.status === 400, same.text)
  check('sign-in still works meanwhile', (await call('POST', '/api/login', {body: {password: 'correct-horse-battery'}})).status === 200)

  const changed = await call('PUT', '/api/password', {cookie, body: {current: 'correct-horse-battery', next: 'a-brand-new-passphrase'}})
  check('the password changes', changed.status === 200, changed.text)
  check('the old password stops working', (await call('POST', '/api/login', {body: {password: 'correct-horse-battery'}})).status === 401)
  check('the new password works', (await call('POST', '/api/login', {body: {password: 'a-brand-new-passphrase'}})).status === 200)
  check('the stored hash is not the password', !JSON.stringify([...memory.keys()].map(String)).includes('passphrase'))
  const stored = JSON.parse((await store.readText('site/auth.json')) || '{}')
  check('a salt and hash were written', Boolean(stored.salt && stored.hash))
  check('the password itself was not written', !JSON.stringify(stored).includes('a-brand-new-passphrase'))
  check('changing it again needs the new one', (await call('PUT', '/api/password', {cookie, body: {current: 'a-brand-new-passphrase', next: 'yet-another-long-one'}})).status === 200)
  check('signed-out callers cannot change it', (await call('PUT', '/api/password', {body: {current: 'yet-another-long-one', next: 'nope-nope-nope'}})).status === 401)

  console.log('\nSigning out')
  const out = await call('POST', '/api/logout', {cookie})
  check('sign-out clears the cookie', out.status === 200 && /Max-Age=0/.test(out.headers['Set-Cookie'] || ''))
  check('a forged cookie is refused', (await call('GET', '/api/pages', {cookie: 'spes_session=1.99999999999999.' + 'f'.repeat(64)})).status === 401)

  console.log(`\n${passed} passed, ${failed} failed\n`)
  process.exit(failed ? 1 : 0)
}

main().catch(error => { console.error(error); process.exit(1) })
