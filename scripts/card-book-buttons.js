/* One-off: every service card on My Services closes with its own "Book here"
   link to the contact page, and the single stray booking button under the grid
   goes away.

   The card copy on disk and the card copy in Blob have drifted apart — Lisa has
   edited the live one through the console — so nothing here matches on the
   wording of a card. It works on the markup around it: one button before each
   </article>, and the trailing paragraph removed by its own shape.

   node scripts/card-book-buttons.js          # report only, writes nothing
   node scripts/card-book-buttons.js --write  # take a backup, then write */

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

const BUTTON = '<a class="button card-book" href="/contact/">Book here</a>'

function patch(html) {
  let count = 0
  // A card at a time, so a card that already has its button is left as it is.
  let next = html.replace(/<article class="card">([\s\S]*?)<\/article>/g, (whole, inner) => {
    if (inner.includes('card-book')) return whole
    count++
    return `<article class="card">${inner}${BUTTON}</article>`
  })
  // The one booking button that used to stand under the whole grid, and the
  // empty paragraph left behind beside it.
  const removed = []
  const strays = [
    /<p class="prose"><a class="button" href="\{\{HALAXY_URL\}\}">Book an appointment<\/a><\/p>/g,
    /<p class="prose">\s*<\/p>/g,
  ]
  for (const pattern of strays) {
    const before = next
    next = next.replace(pattern, '')
    if (next !== before) removed.push(pattern.source.slice(0, 40))
  }
  return {next, count, removed: removed.length}
}

async function main() {
  const write = process.argv.includes('--write')
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupDir = path.join(__dirname, '..', '.backup', `cards-${stamp}`)
  if (write) fs.mkdirSync(backupDir, {recursive: true})

  const say = (where, {count, removed}, changed) =>
    console.log(`  ${changed ? (write ? '✓' : '→') : '='}    ${where.padEnd(22)} ${changed ? `${count} buttons added, ${removed} stray block(s) removed` : 'nothing to change'}`)

  // ---- disk ----
  const file = path.join(__dirname, '..', 'my-services', 'index.html')
  const disk = fs.readFileSync(file, 'utf8')
  const diskResult = patch(disk)
  say('disk my-services', diskResult, diskResult.next !== disk)
  if (diskResult.next !== disk && write) fs.writeFileSync(file, diskResult.next, 'utf8')

  // ---- Blob: the copy the site actually serves ----
  const key = store.pageKey('help')
  const html = await store.readText(key, {fresh: true})
  if (html === null) { console.log('  -    blob page help          not in Blob'); return }
  if (write) fs.writeFileSync(path.join(backupDir, 'help.html'), html, 'utf8')
  const blobResult = patch(html)
  say('blob page help', blobResult, blobResult.next !== html)
  if (blobResult.next !== html && write) await store.writeText(key, blobResult.next, 'text/html; charset=utf-8')

  console.log(write ? `\nWritten. Backup: ${backupDir}` : '\nReport only — nothing written. Run again with --write to apply.')
}

main().catch(error => { console.error(error); process.exit(1) })
