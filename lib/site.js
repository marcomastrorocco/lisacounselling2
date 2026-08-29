/* ---------- what the console knows about the site ----------
   The same rules the local server always used, with the file reads and writes
   lifted out: every function here takes text and returns text, so the caller
   decides whether that text comes from Blob or from disk. */

const seedPages = [
  {id: 'home', label: 'Home', file: 'index.html', path: '/', locked: true},
  {id: 'about', label: 'About', file: 'about/index.html', path: '/about/'},
  {id: 'help', label: 'My Services', file: 'my-services/index.html', path: '/my-services/'},
  {id: 'approach', label: 'My Approach', file: 'approach/index.html', path: '/approach/'},
  {id: 'violence', label: 'Domestic & Family Violence', file: 'domestic-family-violence/index.html', path: '/domestic-family-violence/'},
  {id: 'contact', label: 'Contact', file: 'contact/index.html', path: '/contact/'},
  {id: 'privacy', label: 'Privacy Policy', file: 'privacy/index.html', path: '/privacy/'},
]

const defaultProfile = {name: 'Lisa Chiarini', credential: 'ACA Registered Counsellor', role: 'Site administrator', photo: ''}

const RESERVED = new Set(['admin', 'api', 'assets', 'static', 'vendor', 'node_modules', 'index.html', 'favicon.ico'])

const escapeHtml = value => String(value).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]))
// Titles are stored HTML-escaped; report them the way a reader sees them.
const decodeHtml = value => String(value).replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, m => ({'&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&nbsp;': ' '}[m]))

const validSlug = slug => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) && slug.length <= 60

function slugTaken(slug, pages) {
  if (RESERVED.has(slug)) return true
  return pages.some(page => page.id === slug || page.path === `/${slug}/`)
}

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
  <link rel="stylesheet" href="/styles.css?v=plum-fix">
  <script src="/shell.js"></script>
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

/* The whole site's navigation lives in shell.js, so one edit covers every page.
   Returns the new text, or null when the anchors it needs are not where it
   expects them — the caller then reports that the nav was left alone. */
function updateNavigation(shell, action, {label, path: href}) {
  if (typeof shell !== 'string') return null
  const headerAnchor = '<a class="button" href="{{HALAXY_URL}}">Book an appointment</a>'
  const footerAnchor = '<a href="/privacy/">Privacy Policy</a>'
  const link = `<a href="${href}">${label}</a>`

  if (action === 'add') {
    if (shell.includes(link) || !shell.includes(headerAnchor) || !shell.includes(footerAnchor)) return null
    return shell.replace(headerAnchor, link + headerAnchor).replace(footerAnchor, link + footerAnchor)
  }
  if (!shell.includes(link)) return null
  return shell.split(link).join('')
}

function updateSitemap(xml, action, href) {
  if (typeof xml !== 'string') return null
  const entry = `<url><loc>https://www.spescounselling.com.au${href}</loc></url>`
  if (action === 'add') {
    if (xml.includes(entry)) return null
    return xml.replace('</urlset>', entry + '</urlset>')
  }
  if (!xml.includes(entry)) return null
  return xml.split(entry).join('')
}

/* ---------- which uploads a document points at ----------
   Everything the console uploads is addressed as /media/<name>, and a name
   carries the moment of its upload so it is never handed out twice. That makes
   a plain scan of the text exact, and it finds the address wherever it sits: an
   <img src>, a <source srcset>, a video poster or a style attribute. */
const MEDIA_REFERENCE = /\/media\/([A-Za-z0-9][A-Za-z0-9._-]*)/g

function mediaNamesIn(text) {
  const names = new Set()
  if (typeof text !== 'string') return names
  for (const match of text.matchAll(MEDIA_REFERENCE)) names.add(match[1])
  return names
}

function pageStats({id, label, file, path: href, locked}, html, modified) {
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
    modified,
    indexed: !/noindex/i.test(html),
  }
}

module.exports = {
  seedPages, defaultProfile, RESERVED,
  escapeHtml, decodeHtml, validSlug, slugTaken,
  pageTemplate, updateNavigation, updateSitemap, pageStats, mediaNamesIn,
}
