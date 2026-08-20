/* Exercises lib/handler.js against an in-memory stand-in for Vercel Blob, so the
   whole console can be checked without a real store or a token. */

const Module = require('module')
const path = require('path')

const project = path.join(__dirname, '..')
const memory = new Map()

const fakeBlob = {
  async put(pathname, body, options) {
    if (!options || !options.access) throw new Error('put() needs an access option')
    if (memory.has(pathname) && !options.allowOverwrite) throw new Error('blob already exists')
    memory.set(pathname, {
      body: Buffer.isBuffer(body) ? body : Buffer.from(String(body)),
      access: options.access,
      contentType: options.contentType,
    })
    return {pathname, url: `https://fake123.public.blob.vercel-storage.com/${pathname}`}
  },
  async get(pathname, options) {
    if (!options || !options.access) throw new Error('get() needs an access option')
    const found = memory.get(pathname)
    if (!found) return null
    return {statusCode: 200, stream: new Response(found.body).body, headers: new Headers(), blob: {}}
  },
  async list(options) {
    const prefix = (options && options.prefix) || ''
    return {
      blobs: [...memory.entries()]
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, value]) => ({pathname: key, url: `https://fake123.public.blob.vercel-storage.com/${key}`, size: value.body.length})),
    }
  },
  async del(pathname) { memory.delete(pathname) },
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
  check('/api/pages lists the seven pages', pages.status === 200 && pages.json.length === 7, pages.text.slice(0, 120))
  check('/admin/app.js is served once signed in', (await call('GET', '/admin/app.js', {cookie})).status === 200)
  const one = await call('GET', '/api/page?id=about', {cookie})
  check('/api/page returns the HTML', one.status === 200 && one.json.html.includes('<h1>About</h1>'), one.text.slice(0, 120))
  const stats = await call('GET', '/api/stats', {cookie})
  check('/api/stats measures every page', stats.status === 200 && stats.json.length === 7, stats.text.slice(0, 120))
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
  check('the new page is now listed', (await call('GET', '/api/pages', {cookie})).json.length === 8)
  const clash = await call('POST', '/api/page', {cookie, body: {label: 'Again', slug: 'fees'}})
  check('a duplicate address is refused', clash.status === 409, clash.text)
  const bad = await call('POST', '/api/page', {cookie, body: {label: 'Bad', slug: 'Not A Slug'}})
  check('a malformed address is refused', bad.status === 400)
  const reserved = await call('POST', '/api/page', {cookie, body: {label: 'Nope', slug: 'admin'}})
  check('a reserved address is refused', reserved.status === 409, reserved.text)

  console.log('\nThe published site')
  const home = await call('GET', '/')
  check('the home page is served from the store', home.status === 200 && home.text.includes('<h1>Home</h1>'), home.text.slice(0, 120))
  check('the home page is cached briefly', /s-maxage=60/.test(home.headers['Cache-Control'] || ''))
  const newPage = await call('GET', '/fees/')
  check('the page just created is live', newPage.status === 200 && newPage.text.includes('Fees and Rebates'), newPage.text.slice(0, 160))
  check('a missing trailing slash redirects', (await call('GET', '/fees')).status === 308)
  check('the navigation is served', (await call('GET', '/shell.js')).status === 200)
  check('the sitemap is served', (await call('GET', '/sitemap.xml')).status === 200)
  check('the sitemap gained the new page', (await call('GET', '/sitemap.xml')).text.includes('/fees/'))
  check('the stylesheet still comes off disk', (await call('GET', '/styles.css')).status === 200)
  check('an unknown address is a 404', (await call('GET', '/no-such-page/')).status === 404)

  console.log('\nImages')
  const png = 'data:image/png;base64,' + Buffer.from('fake png bytes').toString('base64')
  const upload = await call('POST', '/api/upload', {cookie, body: {name: 'Lisa Photo.PNG', data: png}})
  check('an image uploads', upload.status === 200 && /public\.blob\.vercel-storage\.com\/media\//.test(upload.json.url), upload.text)
  check('the name is made safe', /\/media\/\d+-lisa-photo\.png$/.test(upload.json.url), upload.json.url)
  const notImage = await call('POST', '/api/upload', {cookie, body: {name: 'x.exe', data: 'data:application/x-msdownload;base64,AAAA'}})
  check('a non-image is refused', notImage.status === 400)
  const media = await call('GET', '/api/media', {cookie})
  check('the library lists the upload', media.status === 200 && media.json.length === 1, media.text)

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
