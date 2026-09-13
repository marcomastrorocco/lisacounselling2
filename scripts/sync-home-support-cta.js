/* Replace only the live home page's outdated support section with the checked-in
   version. Other dashboard edits on the page remain untouched. */

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
const localHome = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8')
const replacement = (localHome.match(/<section class="section surface access-support">[\s\S]*?<\/section>/) || [])[0]
const oldSection = /<section class="section surface"><div class="container prose"><h2>Ways to Access Support<\/h2>[\s\S]*?<\/section>/

async function main() {
  if (!store.configured()) throw new Error('BLOB_READ_WRITE_TOKEN is not set')
  if (!replacement) throw new Error('Local access-support section was not found')
  const key = store.pageKey('home')
  const live = await store.readText(key, {fresh: true})
  if (live === null) throw new Error('Home page is missing from Blob')
  if (!oldSection.test(live)) return console.log('Live home section is already current')
  await store.writeText(key, live.replace(oldSection, replacement), 'text/html; charset=utf-8')
  console.log('Live home support section updated')
}

main().catch(error => { console.error(error.message); process.exit(1) })
