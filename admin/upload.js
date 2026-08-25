/* ---------- sending a file to the store ----------
   The console used to read a file as base64, post it to /api/upload inside JSON
   and let the function write it. Two ceilings came with that, neither of them
   the store's: base64 makes a file a third larger again, and a Vercel function
   may only be handed 4.5 MB of request body at all. A photo straight off a
   phone could clear that by itself — which is why "high quality" pictures
   failed — and video was never going to fit.

   Now the function only signs a URL for one pathname, one content type and one
   size, and the bytes go from the browser to the store directly. What is left
   here is the part a signed URL cannot do for itself: working out what the file
   actually is, and reporting how far along it is.

   Loaded before app.js and editor.js, both of which have their own `api` for
   talking to the console — so it is passed in rather than assumed. */

/* Browsers disagree about a few of these, and some hand over nothing at all for
   a file dragged in from an odd place, so the name is the fallback. */
const BY_EXTENSION = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', jfif: 'image/jpeg',
  webp: 'image/webp', avif: 'image/avif', gif: 'image/gif', svg: 'image/svg+xml',
  mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', qt: 'video/quicktime',
}

/* What the file dialog offers. Extensions as well as types, because a .mov is
   reported inconsistently and a dialog filtered only by type can end up unable
   to see a file the server would have accepted. */
const ACCEPT = [
  'image/png', 'image/jpeg', 'image/webp', 'image/avif', 'image/gif', 'image/svg+xml',
  'video/mp4', 'video/webm', 'video/quicktime',
  '.png', '.jpg', '.jpeg', '.jfif', '.webp', '.avif', '.gif', '.svg', '.mp4', '.m4v', '.webm', '.mov',
].join(',')

function typeOf(file) {
  const claimed = String(file.type || '').toLowerCase()
  if (claimed === 'image/jpg') return 'image/jpeg'
  if (claimed && (claimed.startsWith('image/') || claimed.startsWith('video/'))) return claimed
  const dot = file.name.lastIndexOf('.')
  return dot === -1 ? '' : (BY_EXTENSION[file.name.slice(dot + 1).toLowerCase()] || '')
}

/* Resolves to {url, name, bytes} — url being the address the file answers to on
   the site, which is what goes into the page. onProgress is called with 0..1
   while the bytes are moving, so a long video does not look like a hung page. */
async function spesUpload(file, {api, onProgress}) {
  const contentType = typeOf(file)
  if (!contentType) throw new Error(`${file.name} is not a picture or video this site can use.`)

  const ticket = await api('/api/upload-url', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({name: file.name, contentType, size: file.size}),
  })
  if (!ticket || !ticket.uploadUrl) throw new Error((ticket && ticket.error) || 'The upload was refused.')

  await new Promise((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open('PUT', ticket.uploadUrl)
    request.setRequestHeader('Content-Type', contentType)
    if (onProgress) {
      request.upload.addEventListener('progress', event => {
        if (event.lengthComputable) onProgress(event.loaded / event.total)
      })
    }
    request.addEventListener('load', () => {
      if (request.status >= 200 && request.status < 300) return resolve()
      reject(new Error(`The store would not take that file (${request.status}).`))
    })
    request.addEventListener('error', () => reject(new Error('The upload was interrupted.')))
    request.addEventListener('abort', () => reject(new Error('The upload was cancelled.')))
    request.send(file)
  })

  return {url: ticket.url, name: ticket.name, bytes: file.size, kind: contentType.startsWith('video/') ? 'video' : 'image'}
}

window.spesUpload = spesUpload
window.SPES_ACCEPT = ACCEPT
