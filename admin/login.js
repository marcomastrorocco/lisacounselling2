/* Sign-in for the console.

   Two ways in, decided by admin/supabase.json. With a project URL and anon key
   in that file the browser signs in against Supabase Auth and then hands the
   access token to local-server.js, which checks it with Supabase and issues the
   console's own session cookie. With the file left blank the older local
   password path is used instead, so an unconfigured checkout still runs. */

const $ = id => document.getElementById(id)
const form = $('login-form'), email = $('email'), password = $('password'), button = $('login-button'), error = $('login-error')

/* Only ever bounce back to an admin path, so ?next= cannot redirect elsewhere. */
const requested = new URLSearchParams(location.search).get('next') || ''
const target = /^\/admin(\/|$)/.test(requested) ? requested : '/admin/'

function fail(message) {
  error.textContent = message
  error.hidden = false
  password.select()
}

/* Read the Supabase settings once, before anyone can submit the form. */
let supabase = null
const ready = fetch('/admin/supabase.json')
  .then(reply => reply.ok ? reply.json() : null)
  .catch(() => null)
  .then(config => {
    const url = config && String(config.url || '').trim().replace(/\/+$/, '')
    const anonKey = config && String(config.anonKey || '').trim()
    if (!url || !anonKey) return
    supabase = {url, anonKey}
    $('email-field').hidden = false
    email.required = true
    email.focus()
  })

/* Supabase reports its own reasons; say the common ones the way a person would. */
function readable(result, status) {
  const raw = result.error_description || result.msg || result.error || ''
  if (/invalid login credentials/i.test(raw)) return 'That email address and password do not match.'
  if (/email not confirmed/i.test(raw)) return 'That account still needs its email address confirmed.'
  if (status === 400 && !raw) return 'That email address and password do not match.'
  return raw || 'Sign in failed'
}

async function signInWithSupabase() {
  const reply = await fetch(`${supabase.url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {apikey: supabase.anonKey, 'Content-Type': 'application/json'},
    body: JSON.stringify({email: email.value.trim(), password: password.value}),
  })
  const result = await reply.json().catch(() => ({}))
  if (!reply.ok) throw new Error(readable(result, reply.status))

  /* The rest of the console is guarded by a cookie, not by this token, so trade
     one for the other rather than teaching every other page about Supabase. */
  const session = await fetch('/api/session', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({access_token: result.access_token}),
  })
  const outcome = await session.json().catch(() => ({}))
  if (!session.ok) throw new Error(outcome.error || 'Sign in failed')
}

async function signInWithPassword() {
  const response = await fetch('/api/login', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({password: password.value}),
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.error || 'Sign in failed')
}

form.addEventListener('submit', async event => {
  event.preventDefault()
  await ready
  if (supabase && !email.value.trim()) return fail('Please enter your email address.')
  if (!password.value) return fail('Please enter your password.')
  button.disabled = true
  button.textContent = 'Checking…'
  error.hidden = true
  try {
    if (supabase) await signInWithSupabase()
    else await signInWithPassword()
    button.textContent = 'Welcome back'
    location.href = target
    return
  } catch (problem) {
    fail(problem.message === 'Failed to fetch' ? 'Cannot reach the local server. Is local-server.js running?' : problem.message)
  }
  button.disabled = false
  button.textContent = 'Sign in'
})

$('reveal').addEventListener('click', () => {
  const shown = password.type === 'text'
  password.type = shown ? 'password' : 'text'
  $('reveal').textContent = shown ? 'Show' : 'Hide'
  $('reveal').setAttribute('aria-pressed', String(!shown))
  $('reveal').setAttribute('aria-label', shown ? 'Show password' : 'Hide password')
  password.focus()
})

/* A wrong password because of Caps Lock is the most common sign-in mistake. */
const caps = event => { if (event.getModifierState) $('caps').hidden = !event.getModifierState('CapsLock') }
password.addEventListener('keyup', caps)
password.addEventListener('keydown', caps)
