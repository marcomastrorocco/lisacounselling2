/* One-off: "How I Can Help" becomes "My Services", at /my-services/.

   The site is served from the Blob store, so the rename has to happen there as
   well as on disk: the page index, the shared shell's navigation, the home
   page's own copy of that navigation, the page's heading, and the sitemap.
   The page's internal id stays 'help' — it is a storage key, not a label.

   node scripts/rename-help-page.js          # report only, writes nothing
   node scripts/rename-help-page.js --write  # take a backup, then write */

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

const OLD_PATH = '/how-i-can-help/'
const NEW_PATH = '/my-services/'
const OLD_LABEL = 'How I Can Help'
const NEW_LABEL = 'My Services'

/* Every rewrite below is safe to run twice: each looks for the old wording,
   which is gone once it has been applied. */
const renameNav = text => text
  .split(`<a href="${OLD_PATH}">${OLD_LABEL}</a>`).join(`<a href="${NEW_PATH}">${NEW_LABEL}</a>`)
  .split(OLD_PATH).join(NEW_PATH)

async function main() {
  const write = process.argv.includes('--write')
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupDir = path.join(__dirname, '..', '.backup', `rename-${stamp}`)
  if (write) fs.mkdirSync(backupDir, {recursive: true})

  const report = (what, changed) =>
    console.log(`  ${changed ? (write ? '✓' : '→') : '='}    ${what.padEnd(24)} ${changed ? (write ? 'updated' : 'would update') : 'nothing to change'}`)

  // ---- the page index the console and the router both read ----
  const pages = await store.readJson(store.PAGES, site.seedPages, {fresh: true})
  if (write) fs.writeFileSync(path.join(backupDir, 'pages.json'), JSON.stringify(pages, null, 2), 'utf8')
  const entry = pages.find(page => page.id === 'help')
  const indexChanged = entry && (entry.label !== NEW_LABEL || entry.path !== NEW_PATH)
  report('pages.json', Boolean(indexChanged))
  if (indexChanged && write) {
    entry.label = NEW_LABEL
    entry.path = NEW_PATH
    entry.file = 'my-services/index.html'
    await store.writeJson(store.PAGES, pages)
  }

  // ---- the shared shell, and any page carrying its own navigation ----
  const shell = await store.readText(store.SHELL, {fresh: true})
  if (shell === null) console.log('  -    shell.js                 not in Blob')
  else {
    if (write) fs.writeFileSync(path.join(backupDir, 'shell.js'), shell, 'utf8')
    const next = renameNav(shell)
    report('shell.js', next !== shell)
    if (next !== shell && write) await store.writeText(store.SHELL, next, 'application/javascript; charset=utf-8')
  }

  for (const page of pages) {
    const key = store.pageKey(page.id)
    const html = await store.readText(key, {fresh: true})
    if (html === null) continue
    if (write) fs.writeFileSync(backupDir + `/${page.id}.html`, html, 'utf8')
    let next = renameNav(html)
    // The page's own heading, and the home page's prose links into it.
    if (page.id === 'help') next = next.split(`<h1>${OLD_LABEL}</h1>`).join(`<h1>${NEW_LABEL}</h1>`)
    if (page.id === 'home') next = next
      .split('>Learn how I can help<').join('>Explore my services<')
      .split('>Explore how I can help \u2192<').join('>View my services \u2192<')
    report(`page ${page.id}`, next !== html)
    if (next !== html && write) await store.writeText(key, next, 'text/html; charset=utf-8')
  }

  // ---- the sitemap ----
  const xml = await store.readText(store.SITEMAP, {fresh: true})
  if (xml === null) console.log('  -    sitemap.xml              not in Blob')
  else {
    if (write) fs.writeFileSync(path.join(backupDir, 'sitemap.xml'), xml, 'utf8')
    const next = xml.split(OLD_PATH).join(NEW_PATH)
    report('sitemap.xml', next !== xml)
    if (next !== xml && write) await store.writeText(store.SITEMAP, next, 'application/xml; charset=utf-8')
  }

  console.log(write ? `\nWritten. Backup: ${backupDir}` : '\nReport only — nothing written. Run again with --write to apply.')
}

main().catch(error => { console.error(error); process.exit(1) })
