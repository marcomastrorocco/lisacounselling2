/* Bring the Blob page registry in line with the deployed site without replacing
   content the client has already edited in the dashboard. Run with:
   node scripts/sync-blob-pages.js */

const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')

function loadEnv(file) {
  let text
  try { text = fs.readFileSync(path.join(root, file), 'utf8') } catch { return }
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line)
    if (!match || line.trim().startsWith('#')) continue
    const value = match[2].replace(/^(['"])(.*)\1$/, '$2')
    if (!(match[1] in process.env)) process.env[match[1]] = value
  }
}

loadEnv('.env.local')
loadEnv('.env')

const store = require('../lib/store')
const site = require('../lib/site')
const htmlType = 'text/html; charset=utf-8'

const localPage = page => fs.readFileSync(path.join(root, page.file), 'utf8')

const removeLegacyBookingLinks = text => String(text)
  .replace(/<a class="button" href="\{\{[^}]*\}\}"(?: hidden="")?>Book an [Aa]ppointment<\/a>/g, '')
  .replace(/>Book\s+here<\/a>/g, '>Get in touch</a>')

function currentNavigation(text) {
  return removeLegacyBookingLinks(text)
    .replace(/\/my-services\//g, '/services/')
    .replace(/<a href="\/services\/">My Services<\/a>/g, '<a href="/services/">Services</a>')
    .replace(/<a href="\/domestic-family-violence\/">Domestic (?:&amp;|&) Family Violence<\/a>/g, '')
    .replace(/<a href="\/faqs\/">FAQs<\/a>/g, '')
    .replace(/\s*(?:Â·|·)\s*EAP Counselling/g, '')
    .replace(/<article class="card"><h3>EAP Counselling<\/h3>[\s\S]*?<\/article>/g, '')
}

function currentShell(text) {
  const next = currentNavigation(text)
  if (next.includes('acknowledgement-flags.png')) return next
  const acknowledgement = '<div class="container acknowledgement"><img src="${depth}assets/acknowledgement-flags.png" alt="Aboriginal and Torres Strait Islander flags"><p>SPES Counselling acknowledges the Traditional Custodians of the lands on which we live and work. We pay our respects to Elders past and present and recognise the continuing connection of Aboriginal and Torres Strait Islander peoples to land, waters, culture and community.</p></div>'
  return next.replace('</div></section></footer>`}}customElements', `</div>${acknowledgement}</section></footer>\`}}customElements`)
}

function currentServices(text) {
  return currentNavigation(text)
    .replace('<section class="section"><div class="container"><div class="cards five">', '<section class="section" id="support-services"><div class="container"><div class="cards five">')
    .replace(/(<article class="card"><h3>Private Counselling<\/h3>[\s\S]*?)<a class="button card-book" href="https:\/\/spes-counselling\.splose\.com\/online-booking\/fddbbaf0-a707-4491-876d-832740cfd837">Book an Appointment<\/a>(<\/article>)/, '$1<a class="button card-book" href="#support-services">Learn More</a>$2')
}

function currentHome(existing) {
  let next = currentNavigation(existing)
  if (!next.includes('Private Counselling · NDIS Therapeutic Support')) {
    const marker = '<section class="section surface"><div class="container about-teaser">'
    const support = '<section class="section surface access-support"><div class="container prose"><p>Private Counselling · NDIS Therapeutic Support</p><p><a class="button explore-services" href="/services/">Explore Services →</a></p></div></section>\n'
    if (next.includes(marker)) next = next.replace(marker, support + marker)
  }
  return next
}

async function ensurePage(page) {
  const existing = await store.readText(store.pageKey(page.id), {fresh: true})
  if (existing !== null) {
    const cleaned = page.id === 'services' ? currentServices(existing) : currentNavigation(existing)
    if (page.id === 'home') {
      const next = currentHome(cleaned)
      if (next !== existing) {
        await store.writeText(store.pageKey(page.id), next, htmlType)
        return 'removed legacy booking links; kept dashboard content'
      }
    }
    if (cleaned !== existing) {
      await store.writeText(store.pageKey(page.id), cleaned, htmlType)
      return 'removed legacy booking links; kept dashboard content'
    }
    // This visible wording change keeps all other dashboard edits intact.
    if (page.id === 'services' && existing.includes('<h1>My Services</h1>')) {
      await store.writeText(store.pageKey(page.id), existing.replace('<h1>My Services</h1>', '<h1>Services</h1>'), htmlType)
      return 'updated Services heading and kept dashboard content'
    }
    return 'kept existing dashboard content'
  }
  await store.writeText(store.pageKey(page.id), localPage(page), htmlType)
  return 'copied current project page'
}

async function syncSharedDocuments() {
  const shell = await store.readText(store.SHELL, {fresh: true})
  if (shell !== null) {
    const nextShell = currentShell(shell)
    if (nextShell !== shell) {
      await store.writeText(store.SHELL, nextShell, 'text/javascript; charset=utf-8')
      console.log('Updated shared navigation and footer.')
    }
  }

  const sitemap = await store.readText(store.SITEMAP, {fresh: true})
  if (sitemap !== null) {
    let nextSitemap = sitemap.replace(/https:\/\/www\.spescounselling\.com\.au\/my-services\//g, 'https://www.spescounselling.com.au/services/')
      .replace(/\s*<url><loc>https:\/\/www\.spescounselling\.com\.au\/eap-counselling\/<\/loc><\/url>/g, '')
    for (const href of ['/ndis-therapeutic-support/']) {
      const entry = `  <url><loc>https://www.spescounselling.com.au${href}</loc></url>`
      if (!nextSitemap.includes(`<loc>https://www.spescounselling.com.au${href}</loc>`)) {
        nextSitemap = nextSitemap.replace('</urlset>', `${entry}\n</urlset>`)
      }
    }
    if (nextSitemap !== sitemap) {
      await store.writeText(store.SITEMAP, nextSitemap, 'application/xml')
      console.log('Updated sitemap.')
    }
  }
}

async function main() {
  if (!store.configured()) throw new Error('BLOB_READ_WRITE_TOKEN is not set.')

  const current = await store.readJson(store.PAGES, site.seedPages, {fresh: true})
  const legacyServices = current.find(page => page.id === 'help' || page.path === '/services/')
  const services = site.seedPages.find(page => page.id === 'services')

  // The old registry stored Services as id "help". Copy its Blob document first
  // so renaming the record cannot discard any edits already made in the console.
  if (legacyServices && legacyServices.id !== services.id) {
    const oldContent = await store.readText(store.pageKey(legacyServices.id), {fresh: true})
    const newContent = await store.readText(store.pageKey(services.id), {fresh: true})
    if (newContent === null && oldContent !== null) {
      await store.writeText(store.pageKey(services.id), oldContent, htmlType)
      console.log('  copied existing Services dashboard content')
    }
  }

  // Keep pages the client may have created in the dashboard. Only replace the
  // known, renamed Services record and add the missing built-in pages.
  const knownIds = new Set(site.seedPages.map(page => page.id))
  const retiredPaths = new Set(['/eap-counselling/', '/faqs/'])
  const retained = current.filter(page =>
    page.id !== 'help' && page.path !== '/services/' && !knownIds.has(page.id) &&
    !retiredPaths.has(page.path) && !site.seedPages.some(item => item.path === page.path)
  )
  const next = [...site.seedPages.map(page => ({...page})), ...retained]
  await store.writeJson(store.PAGES, next)
  console.log('Updated page registry.')

  for (const page of next) console.log(`  ${page.label}: ${await ensurePage(page)}`)

  await syncSharedDocuments()
  console.log('\nDone. Existing dashboard edits were preserved.')
}

main().catch(error => {
  console.error(`\nSync failed: ${error.message}\n`)
  process.exit(1)
})
