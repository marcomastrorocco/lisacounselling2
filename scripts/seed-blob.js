/* ---------- filling the store, once ----------
   Copies what the site is today — the seven pages, the navigation, the sitemap,
   the page registry and the profile — out of this project and into Vercel Blob,
   which is where the console reads and writes from now on.

   Safe to run more than once: by default it leaves anything already in the store
   alone, so a re-run after adding a page will not undo the editing done since.
   Pass --force to overwrite regardless.

   Run it with `npm run seed`. */

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

const force = process.argv.includes('--force')
const html = 'text/html; charset=utf-8'

const read = file => {
  try { return fs.readFileSync(path.join(root, file), 'utf8') } catch { return null }
}

async function place(key, text, contentType, label) {
  if (!force && await store.readText(key, {fresh: true}) !== null) {
    console.log(`  skipped  ${label} — already in the store`)
    return false
  }
  await store.writeText(key, text, contentType)
  console.log(`  ${force ? 'replaced' : 'copied  '} ${label}`)
  return true
}

async function main() {
  if (!store.configured()) {
    console.error('\nBLOB_READ_WRITE_TOKEN is not set. Put it in .env.local and try again.\n')
    process.exit(1)
  }

  console.log(force ? '\nReplacing everything in the Blob store:\n' : '\nCopying this project into the Blob store:\n')

  /* The registry first: it names every page the rest of this loop copies, and
     falls back to the seven the site shipped with. */
  const saved = read('admin/pages.json')
  let pages = site.seedPages
  try {
    const parsed = JSON.parse(saved)
    if (Array.isArray(parsed) && parsed.length) pages = parsed
  } catch { /* the seed list it is */ }

  const missing = pages.filter(page => read(page.file) === null)
  if (missing.length) {
    console.error(`\nThese pages are listed but their files are missing: ${missing.map(page => page.file).join(', ')}\n`)
    process.exit(1)
  }

  await place(store.PAGES, JSON.stringify(pages, null, 2) + '\n', 'application/json; charset=utf-8', 'the page registry')

  for (const page of pages) {
    await place(store.pageKey(page.id), read(page.file), html, `${page.label} (${page.file})`)
  }

  await place(store.SHELL, read('shell.js'), 'text/javascript; charset=utf-8', 'the navigation (shell.js)')
  await place(store.SITEMAP, read('sitemap.xml'), 'application/xml', 'the sitemap')

  const profile = read('admin/profile.json') || JSON.stringify(site.defaultProfile, null, 2) + '\n'
  await place(store.PROFILE, profile, 'application/json; charset=utf-8', 'the profile')

  console.log('\nDone. The console now reads and writes all of this from Blob.\n')
}

main().catch(error => {
  console.error(`\nSeeding failed: ${error.message}\n`)
  process.exit(1)
})
