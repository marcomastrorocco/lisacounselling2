/* ---------- sign-in ----------
   A serverless function is thrown away between requests, so the old in-memory
   session table cannot survive here. Instead the cookie carries its own expiry
   and an HMAC of it: any instance can check a session without shared storage,
   and nobody can mint one without SESSION_SECRET.

   The password is kept as a scrypt hash in a private blob, which is what lets it
   be changed from the console — a running function cannot rewrite its own
   environment. Until one has ever been chosen there, SPES_ADMIN_PASSWORD stands
   in, so a fresh deployment can be signed into and is also the way back in if
   the chosen password is ever lost. */

const crypto = require('crypto')
const store = require('./store')

const SESSION_MS = 8 * 60 * 60 * 1000
const COOKIE = 'spes_session'
const AUTH = 'site/auth.json'
const MIN_LENGTH = 10

const digest = value => crypto.createHash('sha256').update(String(value)).digest()

function sameSecret(a, b) {
  return crypto.timingSafeEqual(digest(a), digest(b))
}

function sign(body) {
  return crypto.createHmac('sha256', process.env.SESSION_SECRET || '').update(body).digest('hex')
}

/* Fail closed. Without a secret every cookie would be signed with the same empty
   key, which anyone could reproduce, so refuse to sign in at all instead. */
const ready = () => Boolean(process.env.SESSION_SECRET)

const readAuth = () => store.readJson(AUTH, null)

/* Whether anybody can sign in at all: either a password has been chosen in the
   console, or the environment still carries the one to start from. */
async function hasPassword() {
  if (process.env.SPES_ADMIN_PASSWORD) return true
  const auth = await readAuth()
  return Boolean(auth && auth.salt && auth.hash)
}

async function setPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex')
  await store.writeJson(AUTH, {salt, hash, changed: new Date().toISOString()})
}

async function passwordMatches(password) {
  const auth = await readAuth()
  if (auth && auth.salt && auth.hash) {
    const candidate = crypto.scryptSync(String(password), auth.salt, 64)
    const stored = Buffer.from(auth.hash, 'hex')
    return candidate.length === stored.length && crypto.timingSafeEqual(candidate, stored)
  }
  // Nothing chosen yet, so the environment is still in charge.
  if (!process.env.SPES_ADMIN_PASSWORD) return false
  return sameSecret(password, process.env.SPES_ADMIN_PASSWORD)
}

/* Says what is wrong with a proposed password, or null when nothing is. Length
   is the only rule worth enforcing: it is what actually resists guessing, and a
   demand for punctuation mostly produces a weaker password with a "1!" on the
   end of it. */
function rejectPassword(password) {
  const value = String(password || '')
  if (value.length < MIN_LENGTH) return `Please use at least ${MIN_LENGTH} characters.`
  if (value.length > 200) return 'That password is too long.'
  if (value.trim() !== value) return 'Please remove the spaces at the start or end.'
  return null
}

function issue() {
  const body = `1.${Date.now() + SESSION_MS}`
  return `${body}.${sign(body)}`
}

function valid(token) {
  if (!process.env.SESSION_SECRET) return false
  const parts = String(token || '').split('.')
  if (parts.length !== 3 || parts[0] !== '1') return false
  const body = `${parts[0]}.${parts[1]}`
  // Compare the signature before trusting the expiry it covers.
  if (!sameSecret(parts[2], sign(body))) return false
  const expires = Number(parts[1])
  return Number.isFinite(expires) && expires > Date.now()
}

const readCookie = request =>
  (new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`).exec(request.headers.cookie || '') || [])[1]

const signedIn = request => valid(readCookie(request))

/* Secure is set only off localhost: the dev server speaks plain HTTP, and a
   Secure cookie would simply never come back. */
function cookie(value, maxAge, host) {
  const local = /^(localhost|127\.0\.0\.1)(:|$)/.test(String(host || ''))
  return `${COOKIE}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}` +
    (local ? '' : '; Secure')
}

const signInCookie = host => cookie(issue(), SESSION_MS / 1000, host)
const signOutCookie = host => cookie('', 0, host)

module.exports = {
  SESSION_MS, MIN_LENGTH, AUTH,
  ready, hasPassword, passwordMatches, setPassword, rejectPassword,
  signedIn, signInCookie, signOutCookie,
}
