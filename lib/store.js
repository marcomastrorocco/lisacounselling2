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

const {put, get, list, del, issueSignedToken, presignUrl} = require('@vercel/blob')

const PAGES = 'site/pages.json'
const PROFILE = 'site/profile.json'
const SHELL = 'site/shell.js'
const SITEMAP = 'site/sitemap.xml'
const MEDIA = 'media/'
// Where the same images are answered from on the site.
const MEDIA_PATH = '/media/'
const pageKey = id => `site/pages/${id}.html`

/* ---------- what may be put in the store ----------
   The extension is taken from the type rather than the file name, so a picture
   saved as .jfif or a clip saved as .MOV is addressed by what it actually is
   and the handler can tell video from image by looking at the name alone. */
const MEDIA_TYPES = {
  'image/png': {ext: 'png', kind: 'image'},
  'image/jpeg': {ext: 'jpg', kind: 'image'},
  'image/webp': {ext: 'webp', kind: 'image'},
  'image/avif': {ext: 'avif', kind: 'image'},
  'image/gif': {ext: 'gif', kind: 'image'},
  'image/svg+xml': {ext: 'svg', kind: 'image'},
  'video/mp4': {ext: 'mp4', kind: 'video'},
  'video/webm': {ext: 'webm', kind: 'video'},
  'video/quicktime': {ext: 'mov', kind: 'video'},
}

/* Nothing here is a platform limit any more — see signedPutUrl — so these are
   just what a counselling website has any business holding. */
const MAX_BYTES = {image: 32 * 1024 * 1024, video: 512 * 1024 * 1024}

const VIDEO = /\.(mp4|webm|mov)$/i
const isVideo = name => VIDEO.test(name)
const kindOf = name => isVideo(name) ? 'video' : 'image'

/* The moment of upload keeps the address unique, which is what lets both caches
   in front of it hold the answer for a year. */
function mediaName(raw, ext) {
  const base = String(raw || 'file')
    .replace(/\.[^.]*$/, '')
    .replace(/[^a-z0-9-]/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
    .slice(0, 60) || 'file'
  return `${Date.now()}-${base}.${ext}`
}

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
    kind: kindOf(blob.pathname),
  }))
}

/* ---------- letting the browser talk to the store directly ----------
   A file used to reach the store by being read as base64, posted to /api/upload
   inside JSON, and written from there. That put two ceilings on it that had
   nothing to do with the store: base64 makes a file a third larger again, and a
   Vercel function may only be handed 4.5 MB of request body at all. A photo off
   a modern phone could clear that on its own, and video never stood a chance.

   So the function no longer carries the bytes. It signs a short-lived URL for
   one pathname and the browser sends the file to Blob itself, which is what the
   platform's own docs recommend and what makes the ceiling the store's rather
   than the function's. The signature is scoped to a single content type and a
   size, so the URL cannot be turned into a way to fill the store with anything
   else. */
async function signedPutUrl(name, contentType) {
  const allowed = MEDIA_TYPES[contentType]
  if (!allowed) throw new Error('That file type cannot be uploaded')
  const pathname = MEDIA + name
  const issued = await issueSignedToken({
    pathname,
    operations: ['put'],
    allowedContentTypes: [contentType],
    maximumSizeInBytes: MAX_BYTES[allowed.kind],
  })
  const {presignedUrl} = await presignUrl(issued, {
    operation: 'put',
    pathname,
    allowOverwrite: true,
    addRandomSuffix: false,
    cacheControlMaxAge: 31536000,
  })
  return presignedUrl
}

/* Reading one back the same way, for files too big to hand out from memory.

   `access` is passed although the SDK's own types leave it off the get-shaped
   options: the URL is built as `<store>.<access>.blob.vercel-storage.com`, and
   without it the hostname comes out with the word `undefined` where the access
   segment belongs and resolves nowhere. */
async function signedGetUrl(name, seconds = 3600) {
  const pathname = MEDIA + name
  const validUntil = Date.now() + seconds * 1000
  const issued = await issueSignedToken({pathname, operations: ['get'], validUntil})
  const {presignedUrl} = await presignUrl(issued, {operation: 'get', pathname, access: 'private', validUntil})
  return presignedUrl
}

const remove = pathname => del(pathname)

/* Deleting one uploaded file. The name is what the library and the pages know
   it by; the store's own prefix stays in here with the rest of the layout. */
const removeMedia = name => del(MEDIA + name)

/* One place to notice a missing token, rather than a Blob error surfacing as a
   500 with nothing a reader can act on. */
function configured() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN)
}

module.exports = {
  PAGES, PROFILE, SHELL, SITEMAP, MEDIA, MEDIA_PATH, pageKey,
  MEDIA_TYPES, MAX_BYTES, isVideo, kindOf, mediaName,
  readText, writeText, readJson, writeJson,
  putMedia, readMedia, listMedia, remove, removeMedia, configured,
  signedPutUrl, signedGetUrl,
}
