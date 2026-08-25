/* Page editor — parses the live HTML into fields, shows the page beside them as
   it is being changed, and writes it back through /api/page. Fields are grouped
   into Search listing / Page content / Images so the long list stays navigable. */

const params = new URLSearchParams(location.search)
const pageId = params.get('page') || 'home'
if (params.get('embed') === '1') document.body.classList.add('embed')

const $ = id => document.getElementById(id)
const fields = $('fields'), statusLine = $('status'), saveButton = $('save')
let model, page, dirty = false

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

/* Settings worth keeping between pages — and worth nobody's crash if the browser
   declines to hand its storage over. */
const remember = {
  get(key, fallback) { try { return localStorage.getItem(key) || fallback } catch { return fallback } },
  set(key, value) { try { localStorage.setItem(key, value) } catch { /* storage refused */ } },
}

const esc = value => String(value).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]))
const bytes = n => n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'

/* ---------- the preview ----------
   The frame loads the page's own address, which is the only way the stylesheet,
   the shared header and footer, and every relative image path resolve as they
   will for a visitor. What it then shows is not the saved page but the one being
   edited: its <main> is replaced by the editor's copy, and `twins` records which
   element in the frame answers to which element in the model. A keystroke then
   patches one node — no re-render, no flicker, no scroll thrown away. */
const preview = {
  frame: $('preview-frame'),
  stage: $('preview-stage'),
  note: $('preview-note'),
  twins: new Map(),
  live: false,
}

const FOCUS_MARK = 'data-spes-focus'
const gently = !window.matchMedia('(prefers-reduced-motion: reduce)').matches
const twinOf = node => preview.live ? preview.twins.get(node) : null

function previewNote(text) {
  preview.note.textContent = text || ''
  preview.note.hidden = !text
}

function mountPreview(path) {
  preview.live = false
  preview.twins.clear()
  $('preview-path').textContent = path
  previewNote('Loading the page…')
  /* A fresh query every time, so Reload really does fetch what the website is
     serving rather than the copy the edge cached five seconds ago. */
  preview.frame.src = `${path}?preview=${Date.now()}`
}

function graftPreview() {
  const doc = preview.frame.contentDocument
  if (!doc) throw new Error('the frame cannot be read')
  const shown = doc.querySelector('main')
  const mine = model && model.querySelector('main')
  if (!shown || !mine) throw new Error('this page has no main section')

  const copy = doc.importNode(mine, true)
  shown.replaceWith(copy)

  // A copy of the same tree, so position pairs the two sides up exactly.
  const mineAll = [...mine.querySelectorAll('*')]
  const copyAll = [...copy.querySelectorAll('*')]
  preview.twins.clear()
  mineAll.forEach((node, i) => preview.twins.set(node, copyAll[i]))

  doc.head.insertAdjacentHTML('beforeend',
    `<style>[${FOCUS_MARK}]{outline:2px solid #B98A3B;outline-offset:3px;border-radius:2px}</style>`)

  /* A preview that wanders off to another page has stopped being a preview.
     Links and forms still look and hover exactly as they will on the site. */
  doc.addEventListener('click', event => {
    const link = event.target.closest && event.target.closest('a')
    if (link) event.preventDefault()
  }, true)
  doc.addEventListener('submit', event => event.preventDefault(), true)

  preview.live = true
  previewNote('')
}

preview.frame.addEventListener('load', () => {
  try { graftPreview() }
  catch (error) {
    preview.live = false
    previewNote(`The preview cannot be shown — ${error.message}. Editing and saving are unaffected.`)
  }
})

/* Focus a field and the thing it changes is outlined and scrolled to. On a page
   of forty paragraphs that is most of what makes a preview worth having. */
let spotlit = null
function spotlight(node) {
  if (spotlit) { spotlit.removeAttribute(FOCUS_MARK); spotlit = null }
  const target = node && twinOf(node)
  if (!target) return
  target.setAttribute(FOCUS_MARK, '')
  spotlit = target
  target.scrollIntoView({block: 'center', behavior: gently ? 'smooth' : 'auto'})
}

function showPreview(on) {
  document.body.classList.toggle('preview-off', !on)
  const button = $('preview-toggle')
  button.setAttribute('aria-pressed', String(on))
  button.textContent = on ? 'Hide preview' : 'Show preview'
  remember.set('spes.preview', on ? 'on' : 'off')
}

function setPreviewWidth(mode) {
  preview.stage.dataset.width = mode
  $('width-wide').setAttribute('aria-pressed', String(mode === 'wide'))
  $('width-narrow').setAttribute('aria-pressed', String(mode === 'narrow'))
  remember.set('spes.preview-width', mode)
}

/* ---------- the fields ---------- */

function group(title) {
  const section = document.createElement('section')
  section.className = 'field-group'
  section.innerHTML = `<span class="eyebrow">${title}</span>`
  fields.append(section)
  return section
}

/* Every edit is made twice: once to the model that will be saved, once to its
   twin in the frame. `apply` is written so that one call does either. */
function field(section, {tag, label, value, hint, multiline = true, node, apply, also}) {
  const wrap = document.createElement('div')
  wrap.className = 'field'
  wrap.dataset.search = `${label} ${value}`.toLowerCase()
  wrap.innerHTML = `<label><span class="tag">${tag}</span>${label}</label>`
  const input = document.createElement(multiline ? 'textarea' : 'input')
  input.value = value || ''
  input.addEventListener('input', () => {
    apply(node, input.value)
    const other = twinOf(node)
    if (other) apply(other, input.value)
    if (also) also()
    markDirty()
  })
  input.addEventListener('focus', () => spotlight(node))
  input.addEventListener('blur', () => spotlight(null))
  wrap.append(input)
  if (hint) wrap.insertAdjacentHTML('beforeend', `<p class="hint">${hint}</p>`)
  section.append(wrap)
  return wrap
}

/* Inside a <picture> the browser takes the <source> and never looks at the
   <img>, so an image swapped here would go on showing the old one. Dropping the
   sources is what makes the field mean what it says. */
function setSource(img, value) {
  img.setAttribute('src', value)
  const parent = img.parentElement
  if (parent && parent.tagName === 'PICTURE') {
    [...parent.querySelectorAll('source')].forEach(source => source.remove())
  }
}

/* ---------- choosing an image already uploaded ----------
   Every image the console has ever taken is in the store already, so an image
   field should not have to be given the file a second time to reuse one. This
   is the same list /api/media renders on the dashboard, borrowed as a picker:
   one shared sheet that whichever field opened it gets the answer back from.

   The list is fetched once and then kept, because it only changes when this
   page uploads something — and when it does, the upload puts it there itself
   rather than sending everyone back to the network for one new row. */
const library = {
  sheet: $('media-sheet'),
  grid: $('ml-grid'),
  filter: $('ml-filter'),
  use: $('ml-use'),
  status: $('ml-status'),
  items: null,      // null until the first fetch answers; [] means genuinely empty
  wants: 'image',   // an <img> cannot show a clip, so a picture field is offered pictures
  current: '',      // what the field already shows, marked so a swap is deliberate
  chosen: null,
  onPick: null,
  opener: null,     // the button to hand focus back to on the way out
}

function libraryStatus(text, tone = '') {
  library.status.textContent = text
  tone ? library.status.dataset.tone = tone : delete library.status.dataset.tone
}

function renderLibrary() {
  library.use.disabled = !library.chosen
  if (!library.items) return void (library.grid.innerHTML = '<p class="hint">Loading the library…</p>')
  if (!library.items.length) {
    return void (library.grid.innerHTML = '<p class="hint">No images have been uploaded yet. Use <b>Upload…</b> to add the first one.</p>')
  }
  const needle = library.filter.value.trim().toLowerCase()
  const usable = library.items.filter(item => (item.kind || 'image') === library.wants)
  if (!usable.length) {
    return void (library.grid.innerHTML = `<p class="hint">No ${library.wants === 'video' ? 'video' : 'pictures'} in the library yet.</p>`)
  }
  const shown = usable.filter(item => !needle || item.name.toLowerCase().includes(needle))
  library.grid.innerHTML = shown.map(item => `
    <button class="pick-card" type="button" data-url="${esc(item.url)}" aria-pressed="${item.url === library.chosen}">
      ${item.kind === 'video'
        ? `<video src="${esc(item.url)}" muted playsinline preload="metadata"></video>`
        : `<img src="${esc(item.url)}" alt="" loading="lazy">`}
      <span class="pick-body"><b title="${esc(item.name)}">${esc(item.name)}</b><span>${bytes(item.bytes)}${item.url === library.current ? ' · in use' : ''}</span></span>
    </button>`).join('') || '<p class="hint">No file name matches that.</p>'
}

async function openLibrary(current, onPick, opener, wants = 'image') {
  library.wants = wants
  library.current = current || ''
  library.chosen = current || null
  library.onPick = onPick
  library.opener = opener
  library.filter.value = ''
  library.sheet.hidden = false
  libraryStatus('')
  renderLibrary()
  library.filter.focus()
  if (library.items) return
  try {
    const list = await api('/api/media')
    library.items = Array.isArray(list) ? list : []
  } catch (error) {
    library.items = []
    libraryStatus(error.message, 'error')
  }
  renderLibrary()
}

function closeLibrary() {
  library.sheet.hidden = true
  library.onPick = null
  if (library.opener) library.opener.focus()
  library.opener = null
}

function useChosen() {
  const pick = library.onPick, url = library.chosen
  if (!pick || !url) return
  closeLibrary()
  pick(url)
}

/* An upload is the only thing that adds to the store from here, so it is also
   the only thing that can leave the kept list behind. */
function rememberUpload(url, size, kind) {
  if (!library.items) return
  const name = url.slice(url.lastIndexOf('/') + 1)
  if (library.items.some(item => item.url === url)) return
  library.items.unshift({name, url, bytes: size, kind: kind || 'image'})
}

library.grid.addEventListener('click', event => {
  const card = event.target.closest('.pick-card')
  if (!card) return
  library.chosen = card.dataset.url
  renderLibrary()
})
library.grid.addEventListener('dblclick', event => {
  const card = event.target.closest('.pick-card')
  if (!card) return
  library.chosen = card.dataset.url
  useChosen()
})
library.filter.addEventListener('input', renderLibrary)
library.filter.addEventListener('keydown', event => {
  if (event.key === 'Enter') { event.preventDefault(); useChosen() }
})
library.use.addEventListener('click', useChosen)
$('ml-close').addEventListener('click', closeLibrary)
$('ml-cancel').addEventListener('click', closeLibrary)
library.sheet.addEventListener('click', event => { if (event.target === library.sheet) closeLibrary() })

function imageField(section, index, img) {
  const wrap = document.createElement('div')
  wrap.className = 'field'
  wrap.dataset.search = `image ${index} ${img.getAttribute('src') || ''} ${img.alt || ''}`.toLowerCase()
  wrap.innerHTML = `<label><span class="tag">img</span>Image ${index} — file</label>`

  const row = document.createElement('div')
  row.className = 'image-row'
  const thumb = document.createElement('img')
  thumb.className = 'preview'
  thumb.alt = ''
  thumb.src = img.getAttribute('src') || ''
  const source = document.createElement('input')
  source.value = img.getAttribute('src') || ''

  function useSource(value) {
    setSource(img, value)
    const other = twinOf(img)
    if (other) setSource(other, value)
    thumb.src = value
    markDirty()
  }

  source.addEventListener('input', () => useSource(source.value))
  source.addEventListener('focus', () => spotlight(img))
  source.addEventListener('blur', () => spotlight(null))

  const browse = document.createElement('button')
  browse.className = 'btn small'
  browse.type = 'button'
  browse.textContent = 'Library…'
  browse.addEventListener('click', () => openLibrary(source.value, chosen => {
    source.value = chosen
    useSource(chosen)
    spotlight(img)
    setStatus('Image chosen from the library — press Save changes', 'dirty')
  }, browse))

  const upload = document.createElement('label')
  upload.className = 'upload'
  upload.textContent = 'Upload…'
  const picker = document.createElement('input')
  picker.type = 'file'
  picker.accept = window.SPES_ACCEPT
  picker.addEventListener('change', async () => {
    const file = picker.files[0]
    if (!file) return
    setStatus(`Uploading ${file.name}…`)
    try {
      const result = await spesUpload(file, {
        api,
        onProgress: share => setStatus(`Uploading ${file.name} — ${Math.round(share * 100)}%`),
      })
      rememberUpload(result.url, result.bytes, result.kind)
      source.value = result.url
      useSource(result.url)
      spotlight(img)
      setStatus('Image uploaded — press Save changes', 'dirty')
    } catch (error) { setStatus(error.message, 'error') }
    picker.value = ''
  })

  upload.append(picker)
  row.append(thumb, source, browse, upload)
  wrap.append(row)
  section.append(wrap)

  field(section, {
    tag: 'alt', label: `Image ${index} — description for screen readers`, value: img.alt, multiline: false,
    hint: 'Describe what the image shows. Leave blank only for purely decorative images.',
    node: img, apply: (target, value) => target.alt = value,
  })
}

/* The two search fields are the only ones the page preview cannot show, so they
   get a preview of their own, in the place where they are edited. */
function searchListing(section, path) {
  const card = document.createElement('div')
  card.className = 'serp'
  card.innerHTML = '<span class="serp-url"></span><span class="serp-title"></span><span class="serp-desc"></span>'
  const trail = path.replace(/^\/|\/$/g, '').split('/').filter(Boolean)
  card.querySelector('.serp-url').textContent = ['spescounselling.com.au', ...trail].join(' › ')
  section.append(card)

  const titleLine = card.querySelector('.serp-title')
  const descLine = card.querySelector('.serp-desc')
  return function repaint() {
    const title = model.querySelector('title')
    const description = model.querySelector('meta[name="description"]')
    const titleText = (title ? title.textContent : '').trim()
    const descText = (description ? description.content : '').trim()
    titleLine.textContent = titleText || 'No title yet'
    titleLine.classList.toggle('serp-empty', !titleText)
    descLine.textContent = descText || 'No description yet — Google will choose a sentence from the page instead.'
    descLine.classList.toggle('serp-empty', !descText)
  }
}

async function load() {
  // The rail is built from the live registry so pages added in this session appear.
  const registry = await api('/api/pages')
  page = (Array.isArray(registry) ? registry : []).find(item => item.id === pageId)
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
  const repaintListing = searchListing(seo, page.path)
  const title = model.querySelector('title')
  if (title) {
    field(seo, {
      tag: 'title', label: 'Browser & Google title', value: title.textContent, multiline: false,
      hint: 'Aim for 15–65 characters.',
      node: title, apply: (target, value) => target.textContent = value, also: repaintListing,
    })
  }
  const description = model.querySelector('meta[name="description"]')
  if (description) {
    field(seo, {
      tag: 'meta', label: 'Google description', value: description.content,
      hint: 'Aim for 50–160 characters.',
      node: description, apply: (target, value) => target.content = value, also: repaintListing,
    })
  }
  repaintListing()

  const content = group('Page content')
  const nodes = [...model.querySelectorAll('main h1, main h2, main h3, main p, main li, main a.button')]
  nodes.forEach((node, i) => {
    const tag = node.tagName.toLowerCase()
    field(content, {
      tag, label: node.textContent.trim().slice(0, 62) || `Item ${i + 1}`, value: node.innerHTML,
      multiline: tag !== 'h1' && tag !== 'h2' && tag !== 'h3',
      node, apply: (target, value) => target.innerHTML = value,
    })
  })

  const images = [...model.querySelectorAll('main img')]
  if (images.length) {
    const section = group('Images')
    images.forEach((img, i) => imageField(section, i + 1, img))
  }

  // Only now is there a model for the frame to be grafted with.
  mountPreview(page.path)

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
$('preview-toggle').addEventListener('click', () => showPreview(document.body.classList.contains('preview-off')))
$('preview-reload').addEventListener('click', () => { if (page) mountPreview(page.path) })
$('width-wide').addEventListener('click', () => setPreviewWidth('wide'))
$('width-narrow').addEventListener('click', () => setPreviewWidth('narrow'))
showPreview(remember.get('spes.preview', 'on') !== 'off')
setPreviewWidth(remember.get('spes.preview-width', 'wide') === 'narrow' ? 'narrow' : 'wide')

$('filter').addEventListener('input', event => {
  const needle = event.target.value.trim().toLowerCase()
  document.querySelectorAll('.field').forEach(item => { item.hidden = Boolean(needle) && !item.dataset.search?.includes(needle) })
  document.querySelectorAll('.field-group').forEach(section => {
    section.hidden = ![...section.querySelectorAll('.field')].some(item => !item.hidden)
  })
})
document.addEventListener('keydown', event => {
  if (!library.sheet.hidden && event.key === 'Escape') { event.preventDefault(); return closeLibrary() }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); if (!saveButton.disabled) save() }
})
window.addEventListener('beforeunload', event => { if (dirty) event.preventDefault() })

load().catch(error => {
  fields.innerHTML = `<div class="error-note"><b>Could not open this page.</b><br>${error.message}</div>`
  setStatus('Not loaded', 'error')
  previewNote('There is no page to preview.')
})
