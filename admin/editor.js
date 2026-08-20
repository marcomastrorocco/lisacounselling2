/* Page editor — parses the live HTML into fields, writes it back through
   /api/page. Grouped into Search listing / Page content / Images so the long
   field list stays navigable. */

const params = new URLSearchParams(location.search)
const pageId = params.get('page') || 'home'
if (params.get('embed') === '1') document.body.classList.add('embed')

const $ = id => document.getElementById(id)
const fields = $('fields'), statusLine = $('status'), saveButton = $('save')
let model, dirty = false

/* This page usually runs inside the dashboard's iframe, so an expired session has
   to move the whole window to sign-in, not just the frame. */
async function api(path, options) {
  const response = await fetch(path, options)
  if (response.status === 401) {
    (window.top || window).location.href = '/admin/login.html'
    throw new Error('Your session has ended — signing you back in.')
  }
  return response.json()
}

function setStatus(text, tone = '') {
  statusLine.textContent = text
  tone ? statusLine.dataset.tone = tone : delete statusLine.dataset.tone
}

function markDirty() {
  dirty = true
  setStatus('Unsaved changes', 'dirty')
}

function group(title) {
  const section = document.createElement('section')
  section.className = 'field-group'
  section.innerHTML = `<span class="eyebrow">${title}</span>`
  fields.append(section)
  return section
}

function field(section, {tag, label, value, hint, multiline = true, onInput}) {
  const wrap = document.createElement('div')
  wrap.className = 'field'
  wrap.dataset.search = `${label} ${value}`.toLowerCase()
  wrap.innerHTML = `<label><span class="tag">${tag}</span>${label}</label>`
  const input = document.createElement(multiline ? 'textarea' : 'input')
  input.value = value || ''
  input.addEventListener('input', () => { onInput(input.value); markDirty() })
  wrap.append(input)
  if (hint) wrap.insertAdjacentHTML('beforeend', `<p class="hint">${hint}</p>`)
  section.append(wrap)
  return wrap
}

function imageField(section, index, img) {
  const wrap = document.createElement('div')
  wrap.className = 'field'
  wrap.dataset.search = `image ${index} ${img.getAttribute('src') || ''} ${img.alt || ''}`.toLowerCase()
  wrap.innerHTML = `<label><span class="tag">img</span>Image ${index} — file</label>`

  const row = document.createElement('div')
  row.className = 'image-row'
  const preview = document.createElement('img')
  preview.className = 'preview'
  preview.alt = ''
  preview.src = img.getAttribute('src') || ''
  const source = document.createElement('input')
  source.value = img.getAttribute('src') || ''
  source.addEventListener('input', () => { img.setAttribute('src', source.value); preview.src = source.value; markDirty() })

  const upload = document.createElement('label')
  upload.className = 'upload'
  upload.textContent = 'Upload…'
  const picker = document.createElement('input')
  picker.type = 'file'
  picker.accept = 'image/png,image/jpeg,image/webp,image/svg+xml'
  picker.addEventListener('change', async () => {
    const file = picker.files[0]
    if (!file) return
    setStatus(`Uploading ${file.name}…`)
    try {
      const data = await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result)
        reader.onerror = () => reject(new Error('Could not read that file'))
        reader.readAsDataURL(file)
      })
      const result = await api('/api/upload', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({name: file.name, data})})
      if (!result.url) throw new Error(result.error || 'Upload failed')
      source.value = result.url
      preview.src = result.url
      img.setAttribute('src', result.url)
      markDirty()
      setStatus('Image uploaded — press Save changes', 'dirty')
    } catch (error) { setStatus(error.message, 'error') }
    picker.value = ''
  })

  upload.append(picker)
  row.append(preview, source, upload)
  wrap.append(row)
  section.append(wrap)

  field(section, {
    tag: 'alt', label: `Image ${index} — description for screen readers`, value: img.alt, multiline: false,
    hint: 'Describe what the image shows. Leave blank only for purely decorative images.',
    onInput: value => img.alt = value,
  })
}

async function load() {
  // The rail is built from the live registry so pages added in this session appear.
  const registry = await api('/api/pages')
  const page = (Array.isArray(registry) ? registry : []).find(item => item.id === pageId)
  if (!page) throw new Error('That page is no longer in the site')

  $('pages').innerHTML = ''
  registry.forEach(item => {
    const link = document.createElement('a')
    link.className = 'rail-link'
    link.href = `?page=${encodeURIComponent(item.id)}`
    link.innerHTML = `<span class="glyph">✎</span>${item.label}`
    if (item.id === pageId) link.setAttribute('aria-current', 'page')
    $('pages').append(link)
  })

  $('title').textContent = `Edit ${page.label}`
  setStatus('Loading page…')
  saveButton.disabled = true

  const data = await api(`/api/page?id=${encodeURIComponent(pageId)}`)
  if (!data.html) throw new Error(data.error || 'This page could not be read')
  model = new DOMParser().parseFromString(data.html, 'text/html')
  fields.innerHTML = ''

  const seo = group('Search listing — how this page appears on Google')
  const title = model.querySelector('title')
  if (title) field(seo, {tag: 'title', label: 'Browser & Google title', value: title.textContent, multiline: false, hint: 'Aim for 15–65 characters.', onInput: value => title.textContent = value})
  const description = model.querySelector('meta[name="description"]')
  if (description) field(seo, {tag: 'meta', label: 'Google description', value: description.content, hint: 'Aim for 50–160 characters.', onInput: value => description.content = value})

  const content = group('Page content')
  const nodes = [...model.querySelectorAll('main h1, main h2, main h3, main p, main li, main a.button')]
  nodes.forEach((node, i) => {
    const tag = node.tagName.toLowerCase()
    field(content, {
      tag, label: node.textContent.trim().slice(0, 62) || `Item ${i + 1}`, value: node.innerHTML,
      multiline: tag !== 'h1' && tag !== 'h2' && tag !== 'h3',
      onInput: value => node.innerHTML = value,
    })
  })

  const images = [...model.querySelectorAll('main img')]
  if (images.length) {
    const section = group('Images')
    images.forEach((img, i) => imageField(section, i + 1, img))
  }

  dirty = false
  setStatus(`Ready — ${nodes.length} text fields, ${images.length} images`)
  saveButton.disabled = false
}

async function save() {
  saveButton.disabled = true
  setStatus('Saving…')
  try {
    const html = '<!doctype html>\n' + model.documentElement.outerHTML
    const result = await api('/api/page', {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({id: pageId, html})})
    if (!result.ok) throw new Error(result.error || 'Save failed')
    dirty = false
    setStatus(`Saved at ${new Date().toLocaleTimeString('en-AU', {hour12: false})}`, 'saved')
  } catch (error) { setStatus(error.message, 'error') }
  saveButton.disabled = false
}

saveButton.addEventListener('click', save)
$('filter').addEventListener('input', event => {
  const needle = event.target.value.trim().toLowerCase()
  document.querySelectorAll('.field').forEach(item => { item.hidden = Boolean(needle) && !item.dataset.search?.includes(needle) })
  document.querySelectorAll('.field-group').forEach(section => {
    section.hidden = ![...section.querySelectorAll('.field')].some(item => !item.hidden)
  })
})
document.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); if (!saveButton.disabled) save() }
})
window.addEventListener('beforeunload', event => { if (dirty) event.preventDefault() })

load().catch(error => {
  fields.innerHTML = `<div class="error-note"><b>Could not open this page.</b><br>${error.message}</div>`
  setStatus('Not loaded', 'error')
})
