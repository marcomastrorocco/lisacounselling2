/* Keep the checked-in Services page and its live Blob copy in sync. */

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
const FROM = 'Specialised support for domestic and family violence'
const TO = 'Support for domestic and family violence'

async function updateBlob() {
  const key = store.pageKey('services')
  const html = await store.readText(key, {fresh: true})
  if (html === null) throw new Error('Services page is missing from Blob')
  const next = html.replaceAll(FROM, TO)
  if (next === html) return console.log('Blob: wording already updated')
  await store.writeText(key, next, 'text/html; charset=utf-8')
  console.log('Blob: wording updated')
}

async function main() {
  if (!store.configured()) throw new Error('BLOB_READ_WRITE_TOKEN is not set')
  const file = path.join(__dirname, '..', 'services', 'index.html')
  const html = fs.readFileSync(file, 'utf8')
  const next = html.replaceAll(FROM, TO)
  if (next === html) console.log('Disk: wording already updated')
  else { fs.writeFileSync(file, next, 'utf8'); console.log('Disk: wording updated') }
  await updateBlob()
}

main().catch(error => { console.error(error.message); process.exit(1) })
