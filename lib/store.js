/* ---------- the content store ----------
   Everything the console can edit lives in Vercel Blob instead of on disk, so a
   deployed copy of the site and the console both read the same content and Lisa
   can edit from anywhere. Two kinds of blob, on purpose:

   - Page HTML and the small JSON records are private. Only this server reads
     them, using the store's read-write token; there is no public URL to find.
   - Uploaded images are public, because the browser fetches those itself. */

const {put, get, list, del} = require('@vercel/blob')

const PAGES = 'site/pages.json'
const PROFILE = 'site/profile.json'
const SHELL = 'site/shell.js'
const SITEMAP = 'site/sitemap.xml'
const MEDIA = 'media/'
const pageKey = id => `site/pages/${id}.html`

/* Always read from origin storage. Blob's own CDN caches a blob for a month by
   default, which for content the console rewrites means a page could keep
   serving its old text long after it was edited. Caching belongs one layer up
   instead, in the Cache-Control the handler sends, where it is measured in
   seconds and we control it. */
async function readText(pathname, {fresh = true} = {}) {
  const found = await get(pathname, {access: 'private', useCache: !fresh})
  if (!found || found.statusCode !== 200) return null
  return new Response(found.stream).text()
}

async function writeText(pathname, text, contentType) {
  await put(pathname, text, {
    access: 'private',
    contentType,
    allowOverwrite: true,
    addRandomSuffix: false,
    // Belt and braces: should anything ever read this through the CDN, a minute
    // is the longest it may be out of date.
    cacheControlMaxAge: 60,
  })
}

async function readJson(pathname, fallback, options) {
  try {
    const text = await readText(pathname, options)
    return text === null ? fallback : JSON.parse(text)
  } catch { return fallback }
}

const writeJson = (pathname, value) =>
  writeText(pathname, JSON.stringify(value, null, 2) + '\n', 'application/json; charset=utf-8')

/* Images keep their public URL forever, so the HTML that points at one keeps
   working no matter how the page is later edited. */
async function putMedia(name, body, contentType) {
  const {url} = await put(MEDIA + name, body, {
    access: 'public',
    contentType,
    allowOverwrite: true,
    addRandomSuffix: false,
    cacheControlMaxAge: 31536000,
  })
  return url
}

async function listMedia() {
  const {blobs} = await list({prefix: MEDIA, mode: 'expanded'})
  return blobs.map(blob => ({
    name: blob.pathname.slice(MEDIA.length),
    url: blob.url,
    bytes: blob.size,
  }))
}

const remove = pathname => del(pathname)

/* One place to notice a missing token, rather than a Blob error surfacing as a
   500 with nothing a reader can act on. */
function configured() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN)
}

module.exports = {
  PAGES, PROFILE, SHELL, SITEMAP, MEDIA, pageKey,
  readText, writeText, readJson, writeJson,
  putMedia, listMedia, remove, configured,
}
