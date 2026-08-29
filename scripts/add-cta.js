/* One-off: add the closing "Get in touch" CTA band to every page in the Blob
   store. Pages are served from Blob, not from disk, so a disk edit alone is
   invisible. Reads each page, inserts before </main>, writes it back — every
   other byte of the page, including console edits, is left alone.

   node scripts/add-cta.js          # report only, writes nothing
   node scripts/add-cta.js --write  # take a backup, then write */

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
loadEnv('.env.local'); loadEnv('.env')

const store = require('../lib/store')
const site = require('../lib/site')

/* Heading and supporting line per page. The home page already closes with a
   CTA band, so there it is only the second link that is added. */
const COPY = {
  about:    ['Have a question, or ready to begin?', "Reaching out is often the hardest part. When you feel ready, I'm here to listen."],
  help:     ['Not sure where to start?', 'Send a message and we can talk about what kind of support might suit you best.'],
  approach: ['Wondering whether this approach is right for you?', 'Get in touch and we can talk it through together, with no obligation.'],
  violence: ['Support is available when you are ready.', 'You can reach out confidentially, at your own pace.'],
  privacy:  ['Questions about your privacy or your information?', 'You are welcome to get in touch at any time.'],
}
const LINK = '<a class="button" href="/contact/">Get in touch</a>'

const band = ([heading, line]) =>
  `<section class="cta-band"><div class="container"><h2>${heading}</h2><p>${line}</p>${LINK}</div></section>`

/* The home page's existing band gets the link beside the booking button. */
function patchHome(html) {
  const booking = /(<section class="cta-band">[\s\S]*?)(<a class="button" href="\{\{HALAXY_URL\}\}">Book an appointment<\/a>)([\s\S]*?<\/section>)/
  if (!booking.test(html)) return null
  return html.replace(booking, (m, before, button, after) =>
    `${before}<div class="actions">${button}${LINK.replace('class="button"', 'class="button secondary"')}</div>${after}`)
}

async function main() {
  const write = process.argv.includes('--write')
  const pages = await store.readJson(store.PAGES, site.seedPages, {fresh: true})
  const backupDir = path.join(__dirname, '..', '.backup', new Date().toISOString().replace(/[:.]/g, '-'))
  if (write) fs.mkdirSync(backupDir, {recursive: true})

  for (const page of pages) {
    const key = store.pageKey(page.id)
    const html = await store.readText(key, {fresh: true})
    if (html === null) { console.log(`  -    ${page.id.padEnd(10)} not in Blob, skipped`); continue }
    if (write) fs.writeFileSync(path.join(backupDir, `${page.id}.html`), html, 'utf8')

    // Guard on the destination, not the whole tag: the home page's copy of the
    // link carries an extra class.
    if (html.includes('href="/contact/">Get in touch')) { console.log(`  =    ${page.id.padEnd(10)} already has the CTA`); continue }

    let next
    if (page.id === 'home') next = patchHome(html)
    else if (page.id === 'contact') { console.log(`  -    ${page.id.padEnd(10)} skipped (it is the destination)`); continue }
    else if (COPY[page.id]) {
      if (!html.includes('</main>')) { console.log(`  !    ${page.id.padEnd(10)} no </main>, skipped`); continue }
      next = html.replace('</main>', band(COPY[page.id]) + '</main>')
    } else {
      // A page added later through the console: a plain, neutral band.
      if (!html.includes('</main>')) { console.log(`  !    ${page.id.padEnd(10)} no </main>, skipped`); continue }
      next = html.replace('</main>', band(['Ready to talk?', 'Get in touch and we can find a time that suits you.']) + '</main>')
    }

    if (next === null) { console.log(`  !    ${page.id.padEnd(10)} anchor not found, left alone`); continue }
    if (write) {
      await store.writeText(key, next, 'text/html; charset=utf-8')
      console.log(`  ✓    ${page.id.padEnd(10)} CTA added  (${html.length} → ${next.length} bytes)`)
    } else {
      console.log(`  →    ${page.id.padEnd(10)} would add the CTA  (${html.length} → ${next.length} bytes)`)
    }
  }
  console.log(write ? `\nWritten. Backup of every page as it was: ${backupDir}` : '\nReport only — nothing written. Run again with --write to apply.')
}

main().catch(error => { console.error(error); process.exit(1) })
