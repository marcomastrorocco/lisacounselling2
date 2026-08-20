# The console, and where the website now lives

The console used to run only on one computer: it edited the HTML files in this
project, and the published site was whatever had last been deployed. Now the
pages live in [Vercel Blob](https://vercel.com/docs/vercel-blob) instead, and the
same code that serves the site also serves the console. Lisa can sign in on the
live site and edit it from anywhere; there is nothing to redeploy afterwards.

## What is where

| | Where it lives | Who can read it |
|---|---|---|
| Page HTML, `shell.js`, `sitemap.xml`, the page registry, the profile | Blob, **private** | only this server, using the store's token |
| Images uploaded through the console | Blob, **public** | anyone — the browser loads them directly |
| `styles.css`, `script.js`, `assets/`, the console's own files | this project, deployed to Vercel | anyone |
| The console password | an environment variable | nobody but Vercel |

The HTML files still in this project (`index.html`, `about/index.html` and the
rest) are the **seed**, not the live site. `.vercelignore` keeps them out of the
deployment so they cannot sit in front of the real pages. Edit the live site in
the console, not in these files.

## Three settings

The same three names are needed locally and on Vercel.

| Name | What it is |
|---|---|
| `BLOB_READ_WRITE_TOKEN` | The Blob store's token. Vercel sets this for you when a Blob store is connected to the project. |
| `SPES_ADMIN_PASSWORD` | The password to sign in with **until one is chosen in the console**, and the way back in if that one is ever lost. |
| `SESSION_SECRET` | Signs the session cookie. Any long random string. Changing it signs everyone out. |

Generate a session secret with:

```
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Locally

Copy `.env.example` to `.env.local` and fill in all three. `.env.local` is
gitignored — it must never be committed.

### On Vercel

**Project Settings → Environment Variables.** `BLOB_READ_WRITE_TOKEN` appears on
its own once the Blob store is connected under **Storage**; add the other two by
hand. Without them the live console cannot sign anybody in.

## Getting started

```
npm install
npm run seed     # copies this project's pages into the Blob store, once
npm run dev      # http://127.0.0.1:8000/
```

`npm run seed` skips anything already in the store, so running it twice will not
undo editing done in between. `npm run seed -- --force` overwrites everything
with the files in this project — that is how you roll the live site back to the
version committed here.

`npm test` checks the whole console against an in-memory stand-in for Blob. It
needs no token and touches no real store.

## How a request is answered

1. Vercel's CDN answers it from a static file if there is one — the stylesheet,
   the images in `assets/`, the console's own pages.
2. Everything else is rewritten to `api/index.js`, which is `lib/handler.js`.
3. That handler serves `/api/*` for the console, the console's files under
   `/admin/`, and every page of the site by reading its HTML out of Blob.

`local-server.js` does the same thing on your computer, with one addition: it
also serves the static files from disk, because there is no CDN in front of it.

## Signing in

The browser posts the password to `/api/login`. If it matches, the server returns
a cookie carrying its own expiry and an HMAC of that expiry. Any instance of the
function can check that cookie without shared storage, which is what makes
sign-in work on a platform that throws the server away between requests. Sessions
last eight hours.

## The password, and changing it

The password is held as a scrypt hash in a private blob, not in the environment.
That is what lets it be changed from the console: a running function cannot
rewrite its own environment variables, but it can write a blob.

`SPES_ADMIN_PASSWORD` is the password only **until one is chosen in the console**.
It is how a fresh deployment is first signed into, and it is the way back in
afterwards.

**To change it:** sign in, open the profile panel (the ✎ beside the name), and
use the Password section at the bottom. The current password is asked for as well
as the session, so a console left open on a shared screen cannot be used to lock
its owner out. It takes effect immediately, everywhere.

**If it is ever forgotten:**

```
npm run reset-password
```

That forgets the chosen password and puts `SPES_ADMIN_PASSWORD` back in charge —
pages, images and profile are untouched. Sign in with it, then choose a new one.

Existing sessions are not ended by a password change. The cookie is signed rather
than stored, so there is no list of them to revoke; changing `SESSION_SECRET` in
the deployment invalidates every cookie at once if that is ever needed.

## Two things to know

**Some of the console's own files are public on the live site.** Vercel answers
from a static file before a request ever reaches the function, so `admin/app.js`,
`admin/app.css` and `admin/editor.html` are served straight off the CDN with no
guard in front of them. `/admin/` itself is not — that one reaches the function
and is guarded, which is why `admin/**` is bundled into the function through
`includeFiles` in `vercel.json`. Remove that and the console's front door 404s.

Locally there is no CDN, so `lib/handler.js` guards all of them. The difference
is worth knowing about but not worth chasing: those files are an empty shell.
Every piece of content arrives over `/api/*`, and every one of those routes needs
the session cookie. Someone who opens the console signed out is bounced to the
sign-in page before anything loads.

**Rate limiting is best effort.** Each function instance counts failed sign-ins
separately, so five wrong guesses lock out one instance rather than all of them.
It slows a guesser down; the password's length is what actually protects the
console. Use a long one.

## Caching, and the one trap in it

Blob keeps its own CDN copy of every blob, and by default holds it for a **month**
— which for content the console rewrites would mean a page still serving last
month's text. So `lib/store.js` reads content from origin storage every time
(`useCache: false`), and writes it with a 60-second TTL as a second line of
defence. Do not "optimise" those reads back onto the CDN.

Caching happens one layer up instead, where it is measured in seconds and we
control it: pages go out with `s-maxage=60`, so Vercel's edge may hold a version
for up to a minute after a save. To make saves appear instantly for visitors,
lower `PAGE_CACHE` in `lib/handler.js` — at the cost of running the function on
every single page view.
