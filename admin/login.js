/* Sign-in for the console.

   The password is checked by the server against SPES_ADMIN_PASSWORD, which lives
   in the deployment's environment and never in this project's files. A correct
   password is traded for a signed session cookie; every other console page and
   every /api route is guarded by that cookie. */

const $ = id => document.getElementById(id)
const form = $('login-form'), password = $('password'), button = $('login-button'), error = $('login-error')

/* Only ever bounce back to an admin path, so ?next= cannot redirect elsewhere. */
const requested = new URLSearchParams(location.search).get('next') || ''
const target = /^\/admin(\/|$)/.test(requested) ? requested : '/admin/'

function fail(message) {
  error.textContent = message
  error.hidden = false
  password.select()
}

form.addEventListener('submit', async event => {
  event.preventDefault()
  if (!password.value) return fail('Please enter your password.')
  button.disabled = true
  button.textContent = 'Checking…'
  error.hidden = true
  try {
    const response = await fetch('/api/login', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({password: password.value}),
    })
    const result = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(result.error || 'Sign in failed')
    button.textContent = 'Welcome back'
    location.href = target
    return
  } catch (problem) {
    fail(problem.message === 'Failed to fetch' ? 'Cannot reach the server — check your connection and try again.' : problem.message)
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
