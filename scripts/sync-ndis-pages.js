/* Sync only the reviewed NDIS release pages to the dashboard's Blob store.
   It is intentionally dry-run by default: use --write only when the local
   review is approved and the changes are ready to become live. */

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
const type = 'text/html; charset=utf-8'
const ids = ['services', 'contact', 'ndis-counselling', 'ndis-enquiry']
const only = process.argv.find(argument => argument.startsWith('--only='))?.slice('--only='.length)
const selectedIds = only ? new Set(only.split(',').filter(Boolean)) : new Set(ids)

function disk(page) {
  return fs.readFileSync(path.join(root, page.file), 'utf8')
}

async function main() {
  if (!store.configured()) throw new Error('BLOB_READ_WRITE_TOKEN is not set.')
  const write = process.argv.includes('--write')
  const registry = await store.readJson(store.PAGES, [], {fresh: true})
  const selected = site.seedPages.filter(page => selectedIds.has(page.id))
  const nextRegistry = [...registry]

  for (const page of selected) {
    if (!nextRegistry.some(item => item.id === page.id)) nextRegistry.push({...page})
    const local = disk(page)
    const remote = await store.readText(store.pageKey(page.id), {fresh: true})
    const changed = remote !== local
    console.log(`${changed ? (write ? '✓' : '→') : '='} ${page.label}${changed ? ' will be synced' : ' already matches'}`)
    if (write && changed) await store.writeText(store.pageKey(page.id), local, type)
  }

  const registryChanged = JSON.stringify(registry) !== JSON.stringify(nextRegistry)
  console.log(`${registryChanged ? (write ? '✓' : '→') : '='} Dashboard page registry${registryChanged ? ' will be synced' : ' already includes both NDIS pages'}`)
  if (write && registryChanged) await store.writeJson(store.PAGES, nextRegistry)

  if (!only) {
  const localShell = fs.readFileSync(path.join(root, 'shell.js'), 'utf8')
  const remoteShell = await store.readText(store.SHELL, {fresh: true})
  const shellChanged = remoteShell !== localShell
  console.log(`${shellChanged ? (write ? '✓' : '→') : '='} Main navigation${shellChanged ? ' will be synced' : ' already matches'}`)
  if (write && shellChanged) await store.writeText(store.SHELL, localShell, 'text/javascript; charset=utf-8')

  }
  console.log(write ? '\nNDIS release sync complete.' : '\nDry run only. After approval, run: npm run sync:ndis -- --write')
}

main().catch(error => { console.error(`\nSync failed: ${error.message}\n`); process.exit(1) })
