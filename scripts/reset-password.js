/* ---------- the way back in ----------
   Forgets the password chosen in the console, so the one in
   SPES_ADMIN_PASSWORD is in charge again. Nothing else is touched — the pages,
   the images and the profile are left exactly as they are.

   Run it with `npm run reset-password`. It needs the Blob token, so run it from
   a checkout whose .env.local has one. */

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
const auth = require('../lib/auth')

async function main() {
  if (!store.configured()) {
    console.error('\nBLOB_READ_WRITE_TOKEN is not set. Put it in .env.local and try again.\n')
    process.exit(1)
  }

  const existing = await store.readText(auth.AUTH)
  if (existing === null) {
    console.log('\nNo password has been set in the console — SPES_ADMIN_PASSWORD is already the one that works.\n')
    return
  }

  await store.remove(auth.AUTH)
  console.log('\nDone. The console password is forgotten.')
  console.log('Sign in with SPES_ADMIN_PASSWORD, then choose a new one from the profile panel.\n')

  if (!process.env.SPES_ADMIN_PASSWORD) {
    console.log('Careful: SPES_ADMIN_PASSWORD is not set here. Set it in the deployment')
    console.log('before trying to sign in, or nothing will be accepted.\n')
  }
}

main().catch(error => {
  console.error(`\nReset failed: ${error.message}\n`)
  process.exit(1)
})
