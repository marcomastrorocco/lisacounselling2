/* ---------- the content store ----------
   Everything the console can edit lives in Vercel Blob instead of on disk, so a
   deployed copy of the site and the console both read the same content and Lisa
   can edit from anywhere.

   The store is a *private* one, and that is not something the code can talk it
   out of: a Blob store's access mode is chosen when the store is created and
   fixed from then on. So everything here is written with access: 'private',
   images included, and nothing in the store has a URL a browser can fetch by
   itself. This server holds the token and hands the content out instead —
   pages as HTML, images from /media/. */

const {put, get, list, del} = require('@vercel/blob')

const PAGES = 'site/pages.json'
const PROFILE = 'site/profile.json'
const SHELL = 'site/shell.js'
const SITEMAP = 'site/sitemap.xml'
const MEDIA = 'media/'
// Where the same images are answered from on the site.
const MEDIA_PATH = '/media/'
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

/* An uploaded image is addressed by /media/<name> on this site rather than by a
   blob URL, because a private store has no browser-reachable URL to give. The
   name carries the moment it was uploaded and is never handed out twice, so the
   address always means the same bytes and both caches in front of it — Blob's
   and the CDN's — can hold it for a year. */
async function putMedia(name, body, contentType) {
  await put(MEDIA + name, body, {
    access: 'private',
    contentType,
    allowOverwrite: true,
    addRandomSuffix: false,
    cacheControlMaxAge: 31536000,
  })
  return MEDIA_PATH + name
}

/* Read whole rather than streamed: these are page images, small enough that
   buffering costs nothing and the handler gets to answer them the same way it
   answers everything else. */
async function readMedia(name) {
  const found = await get(MEDIA + name, {access: 'private'})
  if (!found || found.statusCode !== 200) return null
  return {
    body: Buffer.from(await new Response(found.stream).arrayBuffer()),
    contentType: (found.blob && found.blob.contentType) || 'application/octet-stream',
  }
}

async function listMedia() {
  const {blobs} = await list({prefix: MEDIA, mode: 'expanded'})
  return blobs.map(blob => ({
    name: blob.pathname.slice(MEDIA.length),
    url: MEDIA_PATH + blob.pathname.slice(MEDIA.length),
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
  PAGES, PROFILE, SHELL, SITEMAP, MEDIA, MEDIA_PATH, pageKey,
  readText, writeText, readJson, writeJson,
  putMedia, readMedia, listMedia, remove, configured,
}
