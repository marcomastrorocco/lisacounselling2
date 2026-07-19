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

function applyPage(page) {
  if (!page) return
  if (page.seoTitle) document.title = page.seoTitle
  const description = document.querySelector('meta[name="description"]')
  if (description && page.seoDescription) description.content = page.seoDescription

  const textNodes = editableTextNodes()
  for (const block of page.textBlocks || []) {
    const index = Number(block.key?.replace('text-', ''))
    const element = textNodes[index]
    if (!element || !block.content) continue
    element.innerHTML = block.content
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
  if (!settings) return
  document.querySelectorAll('a[href*="{{HALAXY_URL}}"], a[href="{{HALAXY_URL}}"]')
    .forEach((link) => { if (settings.bookingUrl) link.href = settings.bookingUrl })
  document.querySelectorAll('a[href^="mailto:{{PRACTICE_EMAIL}}"]')
    .forEach((link) => {
      if (!settings.email) return
      link.href = `mailto:${settings.email}`
      link.textContent = settings.email
    })
  document.querySelectorAll('form[action="{{CONTACT_FORM_ENDPOINT}}"]')
    .forEach((form) => { if (settings.contactFormEndpoint) form.action = settings.contactFormEndpoint })
}

async function loadCmsContent() {
  if (!pageId) return
  try {
    const query = `{
      "page": *[_type == "editablePage" && pageId == "${pageId}"][0]{..., images[]{..., "imageUrl": image.asset->url}},
      "settings": *[_type == "siteSettings"][0]{...}
    }`
    const {page, settings} = await sanityQuery(query)
    applyPage(page)
    applySettings(settings)
    document.documentElement.dataset.cms = page ? 'connected' : 'fallback'
  } catch (error) {
    console.warn('Using built-in website content because Sanity is unavailable.', error)
    document.documentElement.dataset.cms = 'fallback'
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', loadCmsContent, {once: true})
} else {
  loadCmsContent()
}
