/* One-off: put the real email in the footer and drop the ABN line.

   The footer lives in two places — shell.js, which every page but the home page
   renders, and the home page's own inline copy. Both exist on disk and in the
   Blob store, and the Blob copy is what the site actually serves.

   node scripts/fix-footer.js          # report only, writes nothing
   node scripts/fix-footer.js --write  # take a backup, then write */

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

const EMAIL = 'info@spescounselling.com.au'

/* Both edits are safe to run twice: each looks for something that is gone once
   it has been applied. */
function fixFooter(text) {
  const before = text
  // The placeholder, in the href and in the visible text alike.
  text = text.split('{{PRACTICE_EMAIL}}').join(EMAIL)
  // "ABN: <something><br>" leaves the copyright line as the whole fine print.
  text = text.replace(/ABN:\s*(\{\{ABN\}\}|[^<]*?)\s*<br>\s*/g, '')
  return text === before ? null : text
}

async function main() {
  const write = process.argv.includes('--write')
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupDir = path.join(__dirname, '..', '.backup', `footer-${stamp}`)
  if (write) fs.mkdirSync(backupDir, {recursive: true})

  const report = (where, what, changed) =>
    console.log(`  ${changed ? (write ? '✓' : '→') : '='}    ${where.padEnd(22)} ${changed ? (write ? 'updated' : 'would update') : 'nothing to change'}  ${what}`)

  // ---- disk ----
  for (const file of ['shell.js', 'index.html']) {
    const full = path.join(__dirname, '..', file)
    const text = fs.readFileSync(full, 'utf8')
    const next = fixFooter(text)
    report(`disk ${file}`, '', Boolean(next))
    if (next && write) fs.writeFileSync(full, next, 'utf8')
  }

  // ---- Blob: the shell every page shares ----
  const shell = await store.readText(store.SHELL, {fresh: true})
  if (shell === null) console.log('  -    blob shell.js           not in Blob')
  else {
    if (write) fs.writeFileSync(path.join(backupDir, 'shell.js'), shell, 'utf8')
    const next = fixFooter(shell)
    report('blob shell.js', '', Boolean(next))
    if (next && write) await store.writeText(store.SHELL, next, 'application/javascript; charset=utf-8')
  }

  // ---- Blob: any page carrying its own footer ----
  const pages = await store.readJson(store.PAGES, site.seedPages, {fresh: true})
  for (const page of pages) {
    const key = store.pageKey(page.id)
    const html = await store.readText(key, {fresh: true})
    if (html === null) continue
    if (write) fs.writeFileSync(path.join(backupDir, `${page.id}.html`), html, 'utf8')
    const next = fixFooter(html)
    report(`blob page ${page.id}`, '', Boolean(next))
    if (next && write) await store.writeText(key, next, 'text/html; charset=utf-8')
  }

  console.log(write ? `\nWritten. Backup: ${backupDir}` : '\nReport only — nothing written. Run again with --write to apply.')
}

main().catch(error => { console.error(error); process.exit(1) })
