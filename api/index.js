/* The Vercel entry point. Every request the CDN could not answer from a static
   file arrives here through the rewrite in vercel.json. */
module.exports = require('../lib/handler')
