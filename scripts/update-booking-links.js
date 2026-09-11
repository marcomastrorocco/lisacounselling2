/* Update the general appointment CTAs in both the editable Blob copy (live
   site) and the checked-in page files. Run without --write to review, then use
   --write to back up and apply the replacements. */

const fs = require('fs')
const path = require('path')

function loadEnv(file) {
  let text
  try { text = fs.readFileSync(path.join(__dirname, '..', file), 'utf8') } catch { return }
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line)
    if (!match || line.trim().startsWith('#')) continue
    if (!(match[1] in process.env)) process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2')
  }
}

loadEnv('.env.local')
loadEnv('.env')

const store = require('../lib/store')
const site = require('../lib/site')
const BOOKING_URL = 'https://spes-counselling.splose.com/online-booking/fddbbaf0-a707-4491-876d-832740cfd837'
const anchor = /<a\b([^>]*)href=(['"])(.*?)\2([^>]*)>([\s\S]*?)<\/a>/gi

function plain(html) {
  return html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim()
}

function isBookingLink(attrs, text) {
  const label = plain(text).toLowerCase()
  return /book\s+(an?\s+)?appointment/.test(label) ||
    /splose\.com\/online-booking/.test(attrs)
}

function patchDocument(html) {
  let replacements = 0
  let next = html.replace(anchor, (whole, before, quote, href, after, text) => {
    const attrs = `${before} ${after}`
    if (!isBookingLink(attrs, text) || href === BOOKING_URL) return whole
    replacements++
    return `<a${before}href=${quote}${BOOKING_URL}${quote}${after}>${text}</a>`
  })
  // A Private Counselling card may use neutral button wording such as “Get in
  // touch”; it is still the booking action for that service. Limit this rule
  // to that card so NDIS and EAP actions keep their own destinations.
  next = next.replace(/<article\b[^>]*class=(['"])[^'"]*\bcard\b[^'"]*\1[^>]*>(?:(?!<article\b)[\s\S])*?<h[1-6][^>]*>\s*Private\s+Counselling\s*<\/h[1-6]>(?:(?!<article\b)[\s\S])*?<\/article>/gi, card =>
    card.replace(anchor, (whole, before, quote, href, after, text) => {
      if (href === BOOKING_URL) return whole
      replacements++
      return `<a${before}href=${quote}${BOOKING_URL}${quote}${after}>${text}</a>`
    }))
  return {next, replacements}
}

function bookingAnchors(html) {
  const found = []
  for (const match of html.matchAll(anchor)) {
    const [, before, , href, after, text] = match
    const label = plain(text)
    if (/book|appointment|private counselling/i.test(`${label} ${href} ${before} ${after}`)) {
      found.push({label, href})
    }
  }
  return found
}

function backupPath(name, stamp) {
  return path.join(__dirname, '..', '.backup', `booking-links-${stamp}`, name)
}

async function updateBlob(write, stamp, listOnly) {
  const pages = await store.readJson(store.PAGES, site.seedPages, {fresh: true})
  const documents = [
    {name: 'shell.js', key: store.SHELL, type: 'text/javascript; charset=utf-8'},
    ...pages.map(page => ({name: `${page.id}.html`, key: store.pageKey(page.id), type: 'text/html; charset=utf-8'})),
  ]
  let total = 0
  for (const document of documents) {
    const html = await store.readText(document.key, {fresh: true})
    if (html === null) { console.log(`  - ${document.name}: missing from Blob`); continue }
    if (listOnly) {
      for (const link of bookingAnchors(html)) console.log(`  Blob ${document.name}: ${link.label || '(no text)'} -> ${link.href}`)
      continue
    }
    const result = patchDocument(html)
    total += result.replacements
    console.log(`  ${result.replacements ? (write ? '✓' : '→') : '='} Blob ${document.name}: ${result.replacements} link(s)`) 
    if (write && result.replacements) {
      const file = backupPath(`blob-${document.name}`, stamp)
      fs.mkdirSync(path.dirname(file), {recursive: true})
      fs.writeFileSync(file, html, 'utf8')
      await store.writeText(document.key, result.next, document.type)
    }
  }
  return total
}

function updateDisk(write, stamp, listOnly) {
  const files = ['shell.js', ...site.seedPages.map(page => page.file)]
  let total = 0
  for (const relative of files) {
    const file = path.join(__dirname, '..', relative)
    if (!fs.existsSync(file)) continue
    const html = fs.readFileSync(file, 'utf8')
    if (listOnly) {
      for (const link of bookingAnchors(html)) console.log(`  Disk ${relative}: ${link.label || '(no text)'} -> ${link.href}`)
      continue
    }
    const result = patchDocument(html)
    total += result.replacements
    console.log(`  ${result.replacements ? (write ? '✓' : '→') : '='} Disk ${relative}: ${result.replacements} link(s)`)
    if (write && result.replacements) {
      const backup = backupPath(`disk-${relative.replace(/[\\/]/g, '__')}`, stamp)
      fs.mkdirSync(path.dirname(backup), {recursive: true})
      fs.writeFileSync(backup, html, 'utf8')
      fs.writeFileSync(file, result.next, 'utf8')
    }
  }
  return total
}

function addMissingCtas(name, html) {
  if (html.includes(BOOKING_URL)) return html
  if (name === 'shell.js') {
    return html.replace('<a href="/contact/">Contact</a>', `<a href="/contact/">Contact</a><a class="button" href="${BOOKING_URL}">Book an Appointment</a>`)
  }
  if (name === 'contact.html') {
    return html.replace(/(<div\b[^>]*class=(['"])[^'"]*\bcontact-card\b[^'"]*\2[^>]*>[\s\S]*?)<\/div>/i,
      `$1<a class="button" href="${BOOKING_URL}">Book an appointment</a></div>`)
  }
  return html
}

async function ensureBlobCtas(write) {
  const documents = [
    {name: 'shell.js', key: store.SHELL, type: 'text/javascript; charset=utf-8'},
    {name: 'contact.html', key: store.pageKey('contact'), type: 'text/html; charset=utf-8'},
  ]
  for (const document of documents) {
    const html = await store.readText(document.key, {fresh: true})
    if (html === null) { console.log(`  - Blob ${document.name}: missing`); continue }
    const next = addMissingCtas(document.name, html)
    console.log(`  ${next === html ? '=' : (write ? '✓' : '→')} Blob ${document.name}: ${next === html ? 'CTA already present' : 'booking CTA added'}`)
    if (write && next !== html) await store.writeText(document.key, next, document.type)
  }
}

async function main() {
  const write = process.argv.includes('--write')
  const listOnly = process.argv.includes('--list')
  if (!store.configured()) throw new Error('BLOB_READ_WRITE_TOKEN is not set in .env.local or .env')
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  if (!listOnly) await ensureBlobCtas(write)
  const blob = await updateBlob(write, stamp, listOnly)
  const disk = updateDisk(write, stamp, listOnly)
  if (listOnly) return
  console.log(`\n${write ? 'Updated' : 'Would update'} ${blob} live Blob link(s) and ${disk} disk link(s).`)
  if (write && (blob || disk)) console.log(`Backup: ${path.join(__dirname, '..', '.backup', `booking-links-${stamp}`)}`)
}

main().catch(error => { console.error(error.message); process.exit(1) })
