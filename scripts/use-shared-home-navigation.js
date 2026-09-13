/* Keep Home on the same navigation component as every other page. */

const fs = require('fs')
const path = require('path')

const file = path.join(__dirname, '..', 'index.html')
const html = fs.readFileSync(file, 'utf8')
const shared = '<script src="/shell.js?v=nav-ndis-faq"></script><site-header></site-header>'
const oldHeader = /<a class="skip-link" href="#main">Skip to content<\/a>\s*<header class="site-header">[\s\S]*?<\/header>/

if (html.includes('<site-header></site-header>')) {
  console.log('Home already uses the shared navigation')
} else if (!oldHeader.test(html)) {
  throw new Error('Home navigation markup was not found')
} else {
  fs.writeFileSync(file, html.replace(oldHeader, shared), 'utf8')
  console.log('Home now uses the shared navigation')
}
