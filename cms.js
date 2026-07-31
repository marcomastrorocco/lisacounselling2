const SANITY_PROJECT_ID = '9d7m6ko4'
const SANITY_DATASET = 'production'
const API_VERSION = '2026-07-19'

const pageIds = {
  '/': 'home',
  '/about/': 'about',
  '/how-i-can-help/': 'how-i-can-help',
  '/approach/': 'approach',
  '/domestic-family-violence/': 'domestic-family-violence',
  '/contact/': 'contact',
  '/privacy/': 'privacy',
}

const pageId = pageIds[window.location.pathname] || pageIds[`${window.location.pathname}/`]

async function sanityQuery(query) {
  const url = `https://${SANITY_PROJECT_ID}.api.sanity.io/v${API_VERSION}/data/query/${SANITY_DATASET}?query=${encodeURIComponent(query)}`
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Sanity request failed: ${response.status}`)
  return (await response.json()).result
}

function editableTextNodes() {
  return [...document.querySelectorAll('main h1, main h2, main h3, main p, main li, main label, main button, main a.button')]
}

function editableImages() {
  return [...document.querySelectorAll('main img')]
}

function repairEncodingArtifacts(value) {
  return value
    .replace(/\u00e2\u20ac\u201d/g, '—')
    .replace(/\u00c2\u00b7/g, '·')
    .replace(/\u00e2\u2020\u2019/g, '→')
    .replace(/\u00e2\u20ac\u2122/g, '’')
    .replace(/\u00e2\u20ac\u0153/g, '“')
    .replace(/\u00e2\u20ac\u009d/g, '”')
}

function applyBranding() {
  document.title = document.title
    .replace(/Lisa Chiarini Counselling/gi, 'SPES COUNSELLING')
    .replace(/\s\|\sLisa Chiarini$/i, ' | SPES COUNSELLING')

  const heroName = document.querySelector('.hero-brand-name')
  if (heroName) heroName.textContent = 'SPES'

  const quietWordmark = document.querySelector('.quiet-hero-wordmark')
  const quietLabel = document.querySelector('.quiet-hero-label')
  const quietTagline = document.querySelector('.quiet-hero-tagline')
  if (quietWordmark) quietWordmark.textContent = 'spes'
  if (quietLabel) quietLabel.textContent = 'Counselling'
  if (quietTagline) quietTagline.innerHTML = 'Supporting recovery, resilience<br>and meaningful change.'

  document.querySelectorAll('.contact-card h2').forEach((heading) => {
    if (/Lisa Chiarini Counselling/i.test(heading.textContent)) heading.textContent = 'SPES COUNSELLING'
  })

  document.querySelectorAll('main p').forEach((paragraph) => {
    paragraph.innerHTML = paragraph.innerHTML.replace(/Lisa Chiarini Counselling/gi, 'SPES COUNSELLING')
  })
}

function applyPage(page) {
  if (!page) return
  if (page.seoTitle) document.title = page.seoTitle
  const description = document.querySelector('meta[name="description"]')
  if (description && page.seoDescription) description.content = page.seoDescription

  if (pageId === 'about') {
    for (const block of page.textBlocks || []) {
      if (!block.content || block.content.includes('Edith Cowan University')) continue
      block.content = block.content
        .replace('Master of Counselling · ACA Registered Counsellor', 'Master of Counselling · <strong>Edith Cowan University</strong> · ACA Registered Counsellor')
        .replace('<strong>Master of Counselling</strong>', '<strong>Master of Counselling — Edith Cowan University</strong>')
    }
  }

  const textNodes = editableTextNodes()
  for (const block of page.textBlocks || []) {
    const index = Number(block.key?.replace('text-', ''))
    const element = textNodes[index]
    if (!element || !block.content) continue
    element.innerHTML = repairEncodingArtifacts(block.content)
    if (block.href && element instanceof HTMLAnchorElement) element.href = block.href
  }

  const images = editableImages()
  for (const block of page.images || []) {
    const index = Number(block.key?.replace('image-', ''))
    const image = images[index]
    if (!image || !block.imageUrl) continue
    image.src = `${block.imageUrl}?auto=format&fit=crop&w=1800&q=82`
    image.srcset = ''
    image.alt = block.alt || ''
    const source = image.closest('picture')?.querySelector('source')
    if (source) source.remove()
  }
}

function applySettings(settings) {
  const publicEmail = settings?.email || 'info@spescounselling.com.au'
  document.querySelectorAll('a[href*="{{HALAXY_URL}}"], a[href="{{HALAXY_URL}}"]')
    .forEach((link) => { if (settings?.bookingUrl) link.href = settings.bookingUrl })
  document.querySelectorAll('a[href^="mailto:{{PRACTICE_EMAIL}}"]')
    .forEach((link) => {
      link.href = `mailto:${publicEmail}`
      link.textContent = publicEmail
    })
  document.querySelectorAll('.contact-form')
    .forEach((form) => {
      form.action = '/contact-submit.php'
      if (!form.querySelector('[name="website"]')) {
        const honeypot = document.createElement('div')
        honeypot.hidden = true
        honeypot.setAttribute('aria-hidden', 'true')
        honeypot.innerHTML = '<label>Website<input name="website" tabindex="-1" autocomplete="off"></label>'
        form.append(honeypot)
      }
      const status = new URLSearchParams(location.search)
      if (status.get('sent') === '1') form.insertAdjacentHTML('afterbegin', '<p class="form-status success" role="status">Thank you. Your enquiry has been sent to SPES Counselling.</p>')
      if (status.get('error') === '1') form.insertAdjacentHTML('afterbegin', '<p class="form-status error" role="alert">Your enquiry could not be sent. Please email info@spescounselling.com.au directly.</p>')
    })
}

async function loadCmsContent() {
  applySettings(null)
  if (!pageId) return
  try {
    const query = `{
      "page": *[_type == "editablePage" && pageId == "${pageId}"][0]{..., images[]{..., "imageUrl": image.asset->url}},
      "settings": *[_type == "siteSettings"][0]{...}
    }`
    const {page, settings} = await sanityQuery(query)
    applyPage(page)
    applySettings(settings)
    applyBranding()
    document.documentElement.dataset.cms = page ? 'connected' : 'fallback'
  } catch (error) {
    console.warn('Using built-in website content because Sanity is unavailable.', error)
    applySettings(null)
    applyBranding()
    document.documentElement.dataset.cms = 'fallback'
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', loadCmsContent, {once: true})
} else {
  loadCmsContent()
}
