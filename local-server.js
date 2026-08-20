/* ---------- the development server ----------
   The console and the site itself are in lib/handler.js, which is also what runs
   as a Vercel function in production. This file only gives that handler a local
   address, reads .env.local so the Blob token and password are in the
   environment, and lets it serve the project's static files from disk — a job
   Vercel's CDN does in production.

   Run it with `npm run dev`. */

const http = require('http')
const fs = require('fs')
const path = require('path')

/* Small enough not to be worth a dependency: KEY=value a line, first = wins, and
   an existing environment variable is never overwritten. */
function loadEnv(file) {
  let text
  try { text = fs.readFileSync(path.join(__dirname, file), 'utf8') } catch { return }
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line)
    if (!match || line.trim().startsWith('#')) continue
    const value = match[2].replace(/^(['"])(.*)\1$/, '$2')
    if (!(match[1] in process.env)) process.env[match[1]] = value
  }
}

loadEnv('.env.local')
loadEnv('.env')
process.env.SPES_SERVE_STATIC = '1'

const handler = require('./lib/handler')

const missing = ['BLOB_READ_WRITE_TOKEN', 'SPES_ADMIN_PASSWORD', 'SESSION_SECRET'].filter(name => !process.env[name])
if (missing.length) {
  console.error(`\nMissing from .env.local: ${missing.join(', ')}`)
  console.error('Copy .env.example to .env.local and fill it in, then start again.\n')
  process.exit(1)
}

const port = Number(process.env.PORT) || 8000

http.createServer((request, response) => {
  Promise.resolve(handler(request, response)).catch(error => {
    console.error(error)
    if (response.headersSent) return response.end()
    response.writeHead(500, {'Content-Type': 'application/json; charset=utf-8'})
    response.end(JSON.stringify({error: error.message}))
  })
}).listen(port, '127.0.0.1', () => {
  console.log(`SPES site:    http://127.0.0.1:${port}/`)
  console.log(`SPES console: http://127.0.0.1:${port}/admin/`)
})
