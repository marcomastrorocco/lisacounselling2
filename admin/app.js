/* SPES Console — reads /api/pages, /api/stats and /api/media and renders the real
   numbers. Nothing on this dashboard is placeholder data: if a figure cannot be
   measured it is not shown. */

const VIEWS = [
  {id: 'overview', label: 'Overview', glyph: '◈', hash: '#/overview'},
  {id: 'pages', label: 'Pages', glyph: '▤', hash: '#/pages'},
  {id: 'media', label: 'Media', glyph: '▧', hash: '#/media'},
  {id: 'health', label: 'Site health', glyph: '◉', hash: '#/health'},
]
/* Format → colour is a fixed mapping, so a filter never repaints the survivors. */
const FORMATS = [
  {id: 'webp', label: 'WebP', colour: 'var(--s1)', test: /\.webp$/i},
  {id: 'jpeg', label: 'JPEG', colour: 'var(--s2)', test: /\.jpe?g$/i},
  {id: 'png', label: 'PNG', colour: 'var(--s3)', test: /\.png$/i},
  {id: 'svg', label: 'SVG', colour: 'var(--s4)', test: /\.svg$/i},
  {id: 'gif', label: 'GIF', colour: 'var(--s1)', test: /\.gif$/i},
  {id: 'avif', label: 'AVIF', colour: 'var(--s2)', test: /\.avif$/i},
  {id: 'video', label: 'Video', colour: 'var(--s3)', test: /\.(mp4|webm|mov)$/i},
]
const CHECKS = [
  {id: 'title', label: 'Browser & Google title set (15–65 characters)', test: s => s.title.length >= 15 && s.title.length <= 65},
  {id: 'description', label: 'Google description set (50–160 characters)', test: s => s.description.length >= 50 && s.description.length <= 160},
  {id: 'h1', label: 'Exactly one main heading', test: s => s.h1 === 1},
  {id: 'alt', label: 'Every image carries an alt attribute', test: s => s.imagesWithoutAlt === 0},
  {id: 'depth', label: 'At least 120 words of content', test: s => s.words >= 120},
]

const state = {view: 'overview', page: 'home', stats: [], media: [], profile: {}, deleting: null, booted: false}
const $ = id => document.getElementById(id)
const esc = value => String(value).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]))
/* Labels and addresses come from the server's page registry, so a page added or
   removed in this session needs no change here. */
const pageOf = id => state.stats.find(stat => stat.id === id) || {}
const name = id => pageOf(id).label || id
const pathOf = id => pageOf(id).path || '/'
const slugify = value => value.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)

const compact = n => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 10000 ? (n / 1000).toFixed(1) + 'K' : n.toLocaleString('en-AU')
const bytes = n => n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'
const formatOf = file => (FORMATS.find(f => f.test.test(file)) || FORMATS[2]).id
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
function ago(ms) {
  const mins = Math.round((Date.now() - ms) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours} hr ago`
  const days = Math.round(hours / 24)
  return days < 30 ? `${days} d ago` : new Date(ms).toLocaleDateString('en-AU', {day: 'numeric', month: 'short'})
}

/* ---------- derived measures ---------- */
const scoreOf = stat => CHECKS.filter(check => check.test(stat)).length
const severity = ratio => ratio >= .9 ? 'good' : ratio >= .7 ? 'warn' : 'crit'
const SEVERITY_COLOUR = {good: 'var(--good)', warn: 'var(--warn)', crit: 'var(--crit)'}
const SEVERITY_TRACK = {good: 'var(--track-good)', warn: 'var(--track-warn)', crit: 'var(--track-crit)'}
const SEVERITY_ICON = {good: '●', warn: '▲', crit: '■'}
const SEVERITY_WORD = {good: 'Healthy', warn: 'Needs attention', crit: 'Action required'}

function health() {
  const passed = state.stats.reduce((total, stat) => total + scoreOf(stat), 0)
  const possible = state.stats.length * CHECKS.length || 1
  const ratio = passed / possible
  return {passed, possible, ratio, level: severity(ratio), percent: Math.round(ratio * 100)}
}

function mediaByFormat() {
  return FORMATS.map(format => {
    const files = state.media.filter(item => formatOf(item.name) === format.id)
    return {...format, count: files.length, bytes: files.reduce((total, item) => total + item.bytes, 0)}
  }).filter(format => format.count)
}

/* ---------- chart pieces ---------- */

/* Horizontal bars, one series colour for every bar: the pages are nominal
   categories, so length carries the magnitude and hue carries nothing. */
function barChart(rows, unit) {
  const peak = Math.max(...rows.map(row => row.value), 1)
  return `<div class="bars">${rows.map(row => `
    <div class="bar-row" data-tip="${esc(JSON.stringify(row.tip))}">
      <span class="bar-name">${esc(row.label)}</span>
      <span class="bar-track"><span class="bar-fill" style="width:${(row.value / peak * 100).toFixed(1)}%"></span></span>
      <span class="bar-value">${compact(row.value)}</span>
    </div>`).join('')}</div>
    <p class="card-sub" style="margin:14px 0 0">${esc(unit)}</p>`
}

function stackedBar(segments, total) {
  return `<div class="stack">${segments.map(segment => {
    const share = segment.bytes / total * 100
    /* Only label inside the segment when the text genuinely fits. */
    return `<span class="stack-seg" style="width:${share.toFixed(1)}%;background:${segment.colour}" data-tip="${esc(JSON.stringify({title: segment.label, rows: [['Files', segment.count], ['Weight', bytes(segment.bytes)], ['Share', share.toFixed(1) + '%']]}))}">${share > 14 ? esc(segment.label) : ''}</span>`
  }).join('')}</div>
  <div class="legend">${segments.map(segment => `
    <div class="legend-row"><i style="background:${segment.colour}"></i><span>${esc(segment.label)}</span><span class="num">${plural(segment.count, 'file')}</span><span class="num">${bytes(segment.bytes)}</span></div>`).join('')}</div>`
}

function table(headers, rows) {
  return `<div class="table-wrap"><table class="data"><thead><tr>${headers.map(header => `<th>${esc(header)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${esc(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
}

/* Every chart ships a table twin so no value is reachable by colour alone. */
function twin(id, chart, data) {
  return `<div data-twin="${id}"><div data-face="chart">${chart}</div><div data-face="table" hidden>${data}</div></div>`
}

const twinToggle = id => `<button class="toggle" data-toggle="${id}" type="button">Table</button>`

/* ---------- views ---------- */

function renderOverview() {
  const stats = state.stats
  const words = stats.reduce((total, stat) => total + stat.words, 0)
  const images = stats.reduce((total, stat) => total + stat.images, 0)
  const missingAlt = stats.reduce((total, stat) => total + stat.imagesWithoutAlt, 0)
  const mediaBytes = state.media.reduce((total, item) => total + item.bytes, 0)
  const formats = mediaByFormat()
  const site = health()
  const peakWords = Math.max(...stats.map(stat => stat.words), 1)
  const guarded = stats.filter(stat => !stat.indexed).length

  const depthRows = [...stats].sort((a, b) => b.words - a.words).map(stat => ({
    label: name(stat.id),
    value: stat.words,
    tip: {title: name(stat.id), rows: [['Words', stat.words.toLocaleString('en-AU')], ['Headings', stat.headings], ['Paragraphs', stat.paragraphs], ['Images', stat.images], ['Page weight', bytes(stat.bytes)]]},
  }))

  const feed = [...stats].sort((a, b) => b.modified - a.modified).slice(0, 5)

  $('overview-body').innerHTML = `
    <div class="grid kpi-row">
      ${tile('Live pages', stats.length, 'Published to the site', '▤',
        `<div class="sparkdots">${stats.map(stat => {
          const level = severity(scoreOf(stat) / CHECKS.length)
          return `<i style="background:${SEVERITY_COLOUR[level]}" data-tip="${esc(JSON.stringify({title: name(stat.id), rows: [['Checks passed', `${scoreOf(stat)} of ${CHECKS.length}`], ['Status', SEVERITY_WORD[level]]]}))}"></i>`
        }).join('')}</div>`)}
      ${tile('Words of content', compact(words), `Across ${stats.length} pages`, '¶',
        `<div class="sparkbars">${stats.map(stat => `<i style="height:${Math.max(8, stat.words / peakWords * 100)}%" data-tip="${esc(JSON.stringify({title: name(stat.id), rows: [['Words', stat.words.toLocaleString('en-AU')]]}))}"></i>`).join('')}</div>`)}
      ${tile('Images in use', images, missingAlt ? `${missingAlt} missing an alt attribute` : 'All alt attributes present', '▧',
        `<div class="sparkbars">${stats.map(stat => `<i style="height:${Math.max(8, stat.images / Math.max(...stats.map(s => s.images), 1) * 100)}%;background:${stat.imagesWithoutAlt ? 'var(--warn)' : 'var(--s1)'}" data-tip="${esc(JSON.stringify({title: name(stat.id), rows: [['Images', stat.images], ['Missing alt text', stat.imagesWithoutAlt]]}))}"></i>`).join('')}</div>`)}
      ${tile('Media library', bytes(mediaBytes), `${plural(state.media.length, 'file')} on disk`, '⛁',
        `<div class="sparkstack">${formats.map(format => `<i style="width:${(format.bytes / mediaBytes * 100).toFixed(1)}%;background:${format.colour}" data-tip="${esc(JSON.stringify({title: format.label, rows: [['Files', format.count], ['Weight', bytes(format.bytes)]]}))}"></i>`).join('')}</div>`)}
    </div>

    <div class="grid split">
      <article class="card">
        <div class="card-head"><h2>Content depth by page</h2>${twinToggle('depth')}</div>
        <p class="card-sub">Words of visible copy in each page's main content. Hover a bar for its full breakdown.</p>
        ${twin('depth', barChart(depthRows, 'Longest page first · measured from the live HTML'),
          table(['Page', 'Words', 'Headings', 'Images', 'Weight'], depthRows.map(row => {
            const stat = stats.find(item => name(item.id) === row.label)
            return [row.label, stat.words.toLocaleString('en-AU'), stat.headings, stat.images, bytes(stat.bytes)]
          })))}
      </article>

      <article class="card">
        <div class="card-head"><h2>Site health</h2><span class="pill"><i class="dot ${site.level === 'good' ? '' : site.level}"></i> ${SEVERITY_WORD[site.level]}</span></div>
        <p class="card-sub">${site.passed} of ${site.possible} content checks passing</p>
        <p class="hero-figure num">${site.percent}<span class="hero-unit">%</span></p>
        <div class="meter" style="background:${SEVERITY_TRACK[site.level]}"><i style="width:${site.percent}%;background:${SEVERITY_COLOUR[site.level]}"></i></div>
        <div class="meter-scale"><span>0</span><span>target 100</span></div>
        <ul class="checks">${CHECKS.map(check => {
          const passing = stats.filter(check.test).length
          const level = severity(passing / stats.length)
          return `<li><span class="status-icon" style="color:${SEVERITY_COLOUR[level]}">${SEVERITY_ICON[level]}</span><span>${esc(check.label)}</span><span class="count">${passing}/${stats.length}</span></li>`
        }).join('')}</ul>
      </article>
    </div>

    <div class="grid split-even">
      <article class="card">
        <div class="card-head"><h2>Media weight by format</h2>${twinToggle('formats')}</div>
        <p class="card-sub">Modern WebP versus the JPEG fallbacks it replaces.</p>
        ${twin('formats', stackedBar(formats, mediaBytes),
          table(['Format', 'Files', 'Weight', 'Share'], formats.map(format => [format.label, format.count, bytes(format.bytes), (format.bytes / mediaBytes * 100).toFixed(1) + '%'])))}
      </article>

      <article class="card">
        <div class="card-head"><h2>Recent changes</h2><a class="toggle" href="#/pages">All pages</a></div>
        <p class="card-sub">Last modified time of each page file.</p>
        <ul class="feed">${feed.map(stat => `
          <li><span class="node"></span>
            <span><b>${esc(name(stat.id))}</b><small>${esc(stat.file)} · ${stat.words.toLocaleString('en-AU')} words</small></span>
            <time datetime="${new Date(stat.modified).toISOString()}">${ago(stat.modified)}</time></li>`).join('')}
        </ul>
      </article>
    </div>

    ${guarded ? `<div class="grid"><div class="error-note"><b>Pre-launch guard active.</b> ${guarded} of ${stats.length} pages carry <code>noindex,nofollow</code>, so Google will not list them yet. Remove the guard on every page when the site is approved for launch.</div></div>` : ''}`

  const dot = $('health-dot'), pill = $('health-state')
  dot.className = 'dot' + (site.level === 'good' ? '' : ' ' + site.level)
  pill.textContent = `Health ${site.percent}%`

  $('profile-pages').textContent = stats.length
  $('profile-media').textContent = state.media.length
  $('profile-edited').textContent = ago(Math.max(...stats.map(stat => stat.modified)))
}

function tile(label, value, note, glyph, spark) {
  return `<article class="card tile">
    <div class="tile-top"><p class="tile-label">${esc(label)}</p><span class="tile-icon" aria-hidden="true">${glyph}</span></div>
    <strong class="tile-value">${esc(value)}</strong>
    <p class="tile-note">${esc(note)}</p>
    ${spark}
  </article>`
}

function renderPages() {
  $('pages-body').innerHTML = `<div class="tiles">${state.stats.map(stat => {
    const score = scoreOf(stat)
    const level = severity(score / CHECKS.length)
    return `<article class="card page-card">
      <span class="tag" style="color:${SEVERITY_COLOUR[level]}">${SEVERITY_ICON[level]} ${score}/${CHECKS.length} checks</span>
      <h3>${esc(stat.label)}</h3>
      <p class="path">${esc(stat.file)}</p>
      <div class="page-meta">
        <span>Words <b>${stat.words.toLocaleString('en-AU')}</b></span>
        <span>Headings <b>${stat.headings}</b></span>
        <span>Images <b>${stat.images}</b></span>
        <span>Updated <b>${ago(stat.modified)}</b></span>
      </div>
      <div class="actions">
        <button class="btn primary small" data-go="#/edit/${stat.id}" type="button">Edit content</button>
        <a class="btn small" href="${stat.path}" target="_blank" rel="noopener">View ↗</a>
        ${stat.locked
          ? '<span class="tag" title="The home page cannot be deleted">Permanent</span>'
          : `<button class="btn small" data-delete="${stat.id}" type="button">Delete</button>`}
      </div>
    </article>`
  }).join('')}</div>`
}

/* ---------- add and remove pages ---------- */
function openNewPageSheet() {
  ;['np-label', 'np-slug', 'np-description', 'np-intro'].forEach(id => { $(id).value = '' })
  $('np-nav').checked = true
  $('np-preview').textContent = '/…/'
  setStatusOf('np-status', '')
  $('new-page-sheet').hidden = false
  $('np-label').focus()
}

function setStatusOf(id, text, tone = '') {
  const node = $(id)
  node.textContent = text
  tone ? node.dataset.tone = tone : delete node.dataset.tone
}

async function createPage() {
  const slug = slugify($('np-slug').value || $('np-label').value)
  $('np-create').disabled = true
  setStatusOf('np-status', 'Creating…')
  try {
    const result = await api('/api/page', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        label: $('np-label').value,
        slug,
        description: $('np-description').value,
        intro: $('np-intro').value,
        addToNav: $('np-nav').checked,
      }),
    })
    if (result.error) throw new Error(result.error)
    $('new-page-sheet').hidden = true
    await load(true)
    location.hash = `#/edit/${result.page.id}`
    toast(`“${result.page.label}” created${result.navAdded ? ' and linked in the menu' : ''}`)
  } catch (error) { setStatusOf('np-status', error.message, 'error') }
  $('np-create').disabled = false
}

function openDeleteSheet(id) {
  const stat = pageOf(id)
  if (!stat.id || stat.locked) return
  state.deleting = id
  $('dp-summary').textContent = `“${stat.label}” has ${stat.words.toLocaleString('en-AU')} words and ${stat.images} image${stat.images === 1 ? '' : 's'}. Deleting it cannot be undone from here.`
  $('dp-effects').innerHTML = [
    `Removes the file <code>${esc(stat.file)}</code>`,
    'Removes its link from the site menu and footer',
    `Removes <code>${esc(stat.path)}</code> from the sitemap`,
    'Anyone visiting that address will get a “not found” page',
  ].map(item => `<li>${item}</li>`).join('')
  $('dp-expected').textContent = stat.id
  $('dp-confirm').value = ''
  $('dp-delete').disabled = true
  setStatusOf('dp-status', '')
  $('delete-page-sheet').hidden = false
  $('dp-confirm').focus()
}

async function deletePage() {
  const id = state.deleting
  $('dp-delete').disabled = true
  setStatusOf('dp-status', 'Deleting…')
  try {
    const result = await api(`/api/page?id=${encodeURIComponent(id)}`, {method: 'DELETE'})
    if (result.error) throw new Error(result.error)
    $('delete-page-sheet').hidden = true
    state.deleting = null
    if (location.hash === `#/edit/${id}`) location.hash = '#/pages'
    await load(true)
    renderPages()
    toast(`“${id}” deleted`)
  } catch (error) {
    setStatusOf('dp-status', error.message, 'error')
    $('dp-delete').disabled = false
  }
}

function renderMedia(filter = 'all') {
  const formats = mediaByFormat()
  const shown = state.media.filter(item => filter === 'all' || formatOf(item.name) === filter)
  $('media-body').innerHTML = `
    <div class="filters">
      <button class="chip" data-filter="all" aria-pressed="${filter === 'all'}" type="button">All ${state.media.length}</button>
      ${formats.map(format => `<button class="chip" data-filter="${format.id}" aria-pressed="${filter === format.id}" type="button">${format.label} ${format.count}</button>`).join('')}
    </div>
    <div class="media-grid">${shown.map(item => `
      <article class="card media-card">
        ${(item.kind || formatOf(item.name)) === 'video'
          ? `<video src="${esc(item.url)}" controls playsinline preload="metadata"></video>`
          : `<img src="${esc(item.url)}" alt="" loading="lazy">`}
        <div class="media-body"><b title="${esc(item.name)}">${esc(item.name)}</b><span>${bytes(item.bytes)} · ${esc(item.url.replace('/' + item.name, ''))}</span></div>
      </article>`).join('') || '<p class="card-sub">No images in this format.</p>'}</div>`
}

function renderHealth() {
  const stats = state.stats
  const site = health()
  $('health-body').innerHTML = `
    <div class="grid split">
      <article class="card">
        <div class="card-head"><h2>Checks by page</h2>${twinToggle('checks')}</div>
        <p class="card-sub">How many of the ${CHECKS.length} content checks each page passes.</p>
        ${twin('checks',
          barChart([...stats].sort((a, b) => scoreOf(b) - scoreOf(a)).map(stat => ({
            label: name(stat.id),
            value: scoreOf(stat),
            tip: {title: name(stat.id), rows: CHECKS.map(check => [check.label.split('(')[0].trim(), check.test(stat) ? 'Pass' : 'Fix needed'])},
          })), `Out of ${CHECKS.length} checks per page`),
          table(['Page', ...CHECKS.map(check => check.label.split('(')[0].trim())],
            stats.map(stat => [name(stat.id), ...CHECKS.map(check => check.test(stat) ? 'Pass' : 'Fix')])))}
      </article>
      <article class="card">
        <div class="card-head"><h2>Overall</h2></div>
        <p class="card-sub">${site.passed} of ${site.possible} checks passing</p>
        <p class="hero-figure num">${site.percent}<span class="hero-unit">%</span></p>
        <div class="meter" style="background:${SEVERITY_TRACK[site.level]}"><i style="width:${site.percent}%;background:${SEVERITY_COLOUR[site.level]}"></i></div>
        <div class="meter-scale"><span>0</span><span>target 100</span></div>
        <ul class="checks">${CHECKS.map(check => {
          const failing = stats.filter(stat => !check.test(stat))
          const level = severity((stats.length - failing.length) / stats.length)
          return `<li><span class="status-icon" style="color:${SEVERITY_COLOUR[level]}">${SEVERITY_ICON[level]}</span><span>${esc(check.label)}${failing.length ? `<br><small style="color:var(--ink-3)">${failing.map(stat => esc(name(stat.id))).join(', ')}</small>` : ''}</span><span class="count">${stats.length - failing.length}/${stats.length}</span></li>`
        }).join('')}</ul>
      </article>
    </div>`
}

function renderEditor(id) {
  $('editor-title').textContent = `Edit ${name(id)}`
  $('editor-note').textContent = `${name(id)} · ${pathOf(id)} — change the fields, watch the page beside them, then press Save changes.`
  $('editor-view-link').href = pathOf(id)
  const frame = $('editor-frame')
  const src = `/admin/editor.html?embed=1&page=${encodeURIComponent(id)}`
  if (!frame.src.endsWith(src)) frame.src = src
}

/* ---------- router ---------- */
function route() {
  const hash = location.hash || '#/overview'
  const editing = hash.match(/^#\/edit\/([a-z]+)$/)
  const view = editing ? 'editor' : (VIEWS.find(item => item.hash === hash) || VIEWS[0]).id
  state.view = view
  if (editing) state.page = editing[1]

  document.querySelectorAll('.view').forEach(section => { section.hidden = section.id !== `view-${view}` })
  document.querySelectorAll('.rail-link').forEach(link => {
    const active = link.dataset.hash === hash || (view === 'editor' && link.dataset.page === state.page)
    active ? link.setAttribute('aria-current', 'page') : link.removeAttribute('aria-current')
  })
  $('crumb').textContent = view === 'editor' ? name(state.page) : (VIEWS.find(item => item.id === view) || VIEWS[0]).label
  window.scrollTo({top: 0})

  if (!state.booted) return
  if (view === 'pages') renderPages()
  if (view === 'media') renderMedia()
  if (view === 'health') renderHealth()
  if (view === 'editor') renderEditor(state.page)
}

/* ---------- command palette ---------- */
const palette = {open: false, items: [], matches: [], index: 0}

function paletteItems() {
  return [
    /* Views and actions lead so they survive the result cap on an empty query. */
    ...VIEWS.map(view => ({glyph: view.glyph, label: view.label, hint: 'Go to view', hash: view.hash})),
    {glyph: '⟳', label: 'Refresh telemetry', hint: 'Re-read every page and image from disk', action: () => load(true)},
    ...state.stats.map(stat => ({glyph: '✎', label: `Edit ${name(stat.id)}`, hint: `${stat.words.toLocaleString('en-AU')} words · ${stat.file}`, hash: `#/edit/${stat.id}`})),
    ...state.stats.map(stat => ({glyph: '↗', label: `Open ${name(stat.id)} in a new tab`, hint: pathOf(stat.id), url: pathOf(stat.id)})),
    ...state.media.map(item => ({glyph: '▧', label: item.name, hint: `${bytes(item.bytes)} · ${item.url}`, url: item.url})),
  ]
}

function paletteRender() {
  const list = $('palette-list')
  if (!palette.matches.length) { list.innerHTML = '<li class="empty">Nothing matches that.</li>'; return }
  list.innerHTML = palette.matches.map((item, i) => `
    <li role="option" aria-selected="${i === palette.index}" data-index="${i}">
      <span class="glyph">${item.glyph}</span>
      <span><b>${esc(item.label)}</b><small>${esc(item.hint)}</small></span>
      <span class="tag">↵</span>
    </li>`).join('')
  list.querySelector('[aria-selected="true"]')?.scrollIntoView({block: 'nearest'})
}

function paletteFilter(query) {
  const needle = query.trim().toLowerCase()
  palette.matches = (needle ? palette.items.filter(item => (item.label + ' ' + item.hint).toLowerCase().includes(needle)) : palette.items).slice(0, 40)
  palette.index = 0
  paletteRender()
}

function paletteToggle(open) {
  palette.open = open
  $('palette').hidden = !open
  if (!open) return
  palette.items = paletteItems()
  $('palette-input').value = ''
  paletteFilter('')
  $('palette-input').focus()
}

function paletteRun(item) {
  if (!item) return
  paletteToggle(false)
  if (item.action) return item.action()
  if (item.url) return window.open(item.url, '_blank', 'noopener')
  location.hash = item.hash
}

/* ---------- profile ---------- */
const initials = name => name.split(/\s+/).filter(Boolean).slice(0, 2).map(word => word[0].toUpperCase()).join('') || '·'

function face(node, profile) {
  node.innerHTML = profile.photo
    ? `<img src="${esc(profile.photo)}" alt="">`
    : esc(initials(profile.name || ''))
}

function renderProfile() {
  const profile = state.profile
  face($('profile-avatar'), profile)
  $('profile-name').textContent = profile.name || 'Not set'
  $('profile-credential').textContent = profile.credential || ''
  $('profile-role').textContent = profile.role || ''
  $('profile-credential').hidden = !profile.credential
}

/* The sheet edits a working copy, so Cancel really does discard. */
const draft = {}

function openProfileSheet() {
  Object.assign(draft, state.profile)
  $('pf-name').value = draft.name || ''
  $('pf-credential').value = draft.credential || ''
  $('pf-role').value = draft.role || ''
  face($('pf-preview'), draft)
  setSheetStatus('')
  // Never leave a typed password sitting in a reopened sheet.
  for (const id of ['pw-current', 'pw-next', 'pw-confirm']) $(id).value = ''
  setPasswordStatus('')
  $('profile-sheet').hidden = false
  $('pf-name').focus()
}

function setSheetStatus(text, tone = '') {
  const node = $('pf-status')
  node.textContent = text
  tone ? node.dataset.tone = tone : delete node.dataset.tone
}

async function uploadPhoto(file) {
  setSheetStatus(`Uploading ${file.name}…`)
  const result = await spesUpload(file, {
    api,
    onProgress: share => setSheetStatus(`Uploading ${file.name} — ${Math.round(share * 100)}%`),
  })
  draft.photo = result.url
  draft.name = $('pf-name').value
  face($('pf-preview'), draft)
  setSheetStatus('Photo ready — press Save profile')
}

async function saveProfile() {
  const body = {
    name: $('pf-name').value,
    credential: $('pf-credential').value,
    role: $('pf-role').value,
    photo: draft.photo || '',
  }
  $('pf-save').disabled = true
  setSheetStatus('Saving…')
  try {
    const result = await api('/api/profile', {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)})
    if (result.error) throw new Error(result.error)
    state.profile = result
    renderProfile()
    $('profile-sheet').hidden = true
    toast('Profile updated')
  } catch (error) { setSheetStatus(error.message, 'error') }
  $('pf-save').disabled = false
}

function setPasswordStatus(text, tone = '') {
  const node = $('pw-status')
  node.textContent = text
  tone ? node.dataset.tone = tone : delete node.dataset.tone
}

/* The current password is asked for as well as the session, so a console left
   open on a shared screen cannot be used to lock its owner out. */
async function changePassword() {
  const current = $('pw-current').value
  const next = $('pw-next').value
  if (!current) return setPasswordStatus('Enter your current password.', 'error')
  if (next !== $('pw-confirm').value) return setPasswordStatus('The two new passwords do not match.', 'error')

  $('pw-save').disabled = true
  setPasswordStatus('Changing…')
  try {
    const result = await api('/api/password', {
      method: 'PUT',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({current, next}),
    })
    if (result.error) throw new Error(result.error)
    for (const id of ['pw-current', 'pw-next', 'pw-confirm']) $(id).value = ''
    setPasswordStatus('')
    toast('Password changed')
  } catch (error) { setPasswordStatus(error.message, 'error') }
  $('pw-save').disabled = false
}

/* ---------- chrome ---------- */
function toast(message, level = 'good') {
  const node = document.createElement('div')
  node.className = 'toast'
  node.innerHTML = `<i class="dot ${level === 'good' ? '' : level}"></i><span>${esc(message)}</span>`
  $('toasts').append(node)
  setTimeout(() => node.remove(), 4200)
}

function buildNav() {
  $('nav-main').innerHTML = VIEWS.map((view, i) => `
    <a class="rail-link" href="${view.hash}" data-hash="${view.hash}"><span class="glyph">${view.glyph}</span>${view.label}<kbd>${i + 1}</kbd></a>`).join('')
}

/* Rebuilt after every load, so an added or deleted page appears here too. */
function buildPageNav() {
  $('nav-pages').innerHTML = state.stats.map(stat => `
    <a class="rail-link" href="#/edit/${stat.id}" data-hash="#/edit/${stat.id}" data-page="${stat.id}"><span class="glyph">✎</span>${esc(stat.label)}</a>`).join('')
}

function startClock() {
  const began = Date.now()
  setInterval(() => {
    $('clock').textContent = new Date().toLocaleTimeString('en-AU', {hour12: false})
    const seconds = Math.floor((Date.now() - began) / 1000)
    $('uptime').textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
  }, 1000)
}

/* ---------- data ---------- */

/* One place to notice an expired session: the server answers 401 and we hand the
   viewer back to the sign-in page rather than showing half-empty panels. */
async function api(path, options) {
  const response = await fetch(path, options)
  if (response.status === 401) {
    location.href = `/admin/login.html?next=${encodeURIComponent(location.pathname + location.hash)}`
    throw new Error('Your session has ended — signing you back in.')
  }
  return response.json()
}

async function load(isRefresh = false) {
  const body = $('overview-body')
  if (isRefresh) body.style.opacity = '.45'
  else body.innerHTML = `<div class="grid kpi-row">${'<div class="card"><div class="skeleton loading-line" style="width:45%"></div><div class="skeleton loading-line" style="height:30px"></div><div class="skeleton loading-line" style="width:70%"></div></div>'.repeat(4)}</div>`

  try {
    const [stats, media, profile] = await Promise.all([api('/api/stats'), api('/api/media'), api('/api/profile')])
    if (!Array.isArray(stats)) throw new Error(stats.error || 'Page telemetry unavailable')
    state.stats = stats
    state.media = Array.isArray(media) ? media : []
    state.profile = profile && !profile.error ? profile : {}
    state.booted = true
    renderProfile()
    buildPageNav()
    body.style.opacity = ''
    $('link-dot').className = 'dot live'
    $('link-state').textContent = 'Connected'
    renderOverview()
    route()
    if (isRefresh) toast('Telemetry refreshed from disk')
  } catch (error) {
    state.booted = false
    body.style.opacity = ''
    $('link-dot').className = 'dot crit'
    $('link-state').textContent = 'Offline'
    $('health-dot').className = 'dot crit'
    $('health-state').textContent = 'No data'
    body.innerHTML = `<div class="error-note"><b>Cannot reach the local content API.</b><br>
      This console reads live data from <code>local-server.js</code>. Start it with <code>node local-server.js</code> and open
      <code>http://127.0.0.1:8000/admin/</code>. <br><br>Details: ${esc(error.message)}</div>`
  }
}

/* ---------- events ---------- */
document.addEventListener('click', event => {
  const go = event.target.closest('[data-go]')
  if (go) { event.preventDefault(); location.hash = go.dataset.go; return }

  const toggle = event.target.closest('[data-toggle]')
  if (toggle) {
    const wrap = document.querySelector(`[data-twin="${toggle.dataset.toggle}"]`)
    const showTable = wrap.querySelector('[data-face="table"]').hidden
    wrap.querySelector('[data-face="table"]').hidden = !showTable
    wrap.querySelector('[data-face="chart"]').hidden = showTable
    toggle.textContent = showTable ? 'Chart' : 'Table'
    return
  }

  const chip = event.target.closest('[data-filter]')
  if (chip) return renderMedia(chip.dataset.filter)

  const option = event.target.closest('#palette-list li[data-index]')
  if (option) return paletteRun(palette.matches[Number(option.dataset.index)])

  if (event.target.closest('#omni')) return paletteToggle(true)
  if (event.target.id === 'palette') return paletteToggle(false)

  if (event.target.closest('#sign-out')) {
    return fetch('/api/logout', {method: 'POST'}).finally(() => { location.href = '/admin/login.html' })
  }
  if (event.target.closest('#profile-edit')) return openProfileSheet()
  if (event.target.id === 'pf-save') return saveProfile()
  if (event.target.id === 'pw-save') return changePassword()
  if (event.target.closest('#pf-clear')) {
    draft.photo = ''
    draft.name = $('pf-name').value
    face($('pf-preview'), draft)
    return setSheetStatus('Photo removed — press Save profile')
  }
  if (event.target.closest('#add-page')) return openNewPageSheet()
  if (event.target.id === 'np-create') return createPage()
  if (event.target.id === 'dp-delete') return deletePage()

  const remove = event.target.closest('[data-delete]')
  if (remove) return openDeleteSheet(remove.dataset.delete)

  const close = event.target.closest('[data-close]')
  if (close) return void ($(close.dataset.close).hidden = true)
  if (event.target.classList.contains('backdrop') && event.target.id !== 'palette') event.target.hidden = true
})

/* Suggest an address from the page name until the address is edited by hand. */
$('np-label').addEventListener('input', event => {
  if (!$('np-slug').dataset.touched) $('np-slug').value = slugify(event.target.value)
  $('np-preview').textContent = `/${slugify($('np-slug').value) || '…'}/`
})

$('np-slug').addEventListener('input', event => {
  event.target.dataset.touched = '1'
  $('np-preview').textContent = `/${slugify(event.target.value) || '…'}/`
})

$('dp-confirm').addEventListener('input', event => {
  $('dp-delete').disabled = event.target.value.trim() !== state.deleting
})

$('pf-file').addEventListener('change', async event => {
  const file = event.target.files[0]
  if (!file) return
  try { await uploadPhoto(file) } catch (error) { setSheetStatus(error.message, 'error') }
  event.target.value = ''
})

/* Keep the preview's initials in step while the name is being typed. */
$('pf-name').addEventListener('input', event => {
  draft.name = event.target.value
  if (!draft.photo) face($('pf-preview'), draft)
})

document.addEventListener('keydown', event => {
  const SHEETS = {'profile-sheet': saveProfile, 'new-page-sheet': createPage, 'delete-page-sheet': () => $('dp-delete').disabled || deletePage()}
  const openId = Object.keys(SHEETS).find(id => !$(id).hidden)
  if (openId) {
    if (event.key === 'Escape') return void ($(openId).hidden = true)
    if (event.key === 'Enter' && event.target.tagName === 'INPUT') { event.preventDefault(); SHEETS[openId]() }
    return
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); return paletteToggle(!palette.open) }
  if (palette.open) {
    if (event.key === 'Escape') return paletteToggle(false)
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      palette.index = (palette.index + (event.key === 'ArrowDown' ? 1 : -1) + palette.matches.length) % (palette.matches.length || 1)
      return paletteRender()
    }
    if (event.key === 'Enter') { event.preventDefault(); return paletteRun(palette.matches[palette.index]) }
    return
  }
  if (event.target !== document.body) return
  const index = Number(event.key) - 1
  if (VIEWS[index]) location.hash = VIEWS[index].hash
})

$('palette-input').addEventListener('input', event => paletteFilter(event.target.value))

/* Shared tooltip — hover and keyboard focus show the same content. */
const tip = $('tip')
document.addEventListener('mouseover', event => {
  const target = event.target.closest('[data-tip]')
  if (!target) { tip.hidden = true; return }
  const data = JSON.parse(target.dataset.tip)
  tip.innerHTML = `<b>${esc(data.title)}</b><dl>${data.rows.map(([key, value]) => `<dt>${esc(key)}</dt><dd>${esc(value)}</dd>`).join('')}</dl>`
  tip.hidden = false
  const box = target.getBoundingClientRect()
  tip.style.left = Math.min(box.left, window.innerWidth - tip.offsetWidth - 14) + 'px'
  tip.style.top = (box.top > 150 ? box.top - tip.offsetHeight - 9 : box.bottom + 9) + 'px'
})
document.addEventListener('mouseout', event => { if (event.target.closest('[data-tip]')) tip.hidden = true })

window.addEventListener('hashchange', route)

buildNav()
startClock()
route()
load()
