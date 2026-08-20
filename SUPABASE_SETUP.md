# Supabase sign-in for the SPES console

The console can check who you are against [Supabase Auth](https://supabase.com/auth)
instead of the single local password. Nothing else moves to Supabase — pages,
images and profile still live in the files of this project and are still edited
by `local-server.js`.

Until `admin/supabase.json` is filled in, the console keeps using the old local
password, so the steps below can wait as long as you like.

## 1. Make the project

1. Sign in at [supabase.com](https://supabase.com) and choose **New project**.
2. Give it a name (`lisa-counselling` reads well), set a database password and
   pick the region closest to you — **Sydney** for Australia.
3. Wait for the project to finish provisioning, about two minutes.

## 2. Close the door on self sign-up

**Do this before anything else.** The anon key below is meant to be public, so
if sign-ups stay open, anyone who reads it could create their own account and
walk into the console.

In **Authentication → Sign In / Providers → Email**:

- Turn **Allow new users to sign up** **off**.
- Leave **Confirm email** on.

## 3. Create the admin user

In **Authentication → Users → Add user → Create new user**:

- Email: the address Lisa will sign in with.
- Password: pick a strong one.
- Tick **Auto Confirm User**, otherwise the account cannot sign in until the
  confirmation email is opened.

## 4. Copy the keys into the project

In **Project Settings → API**, copy the **Project URL** and the **anon /
publishable** key — *not* the `service_role` key, which must never leave
Supabase.

Put them in `admin/supabase.json`:

```json
{
  "url": "https://YOUR-PROJECT-ref.supabase.co",
  "anonKey": "eyJhbGciOi...",
  "allowedEmails": ["lisa@example.com"]
}
```

`allowedEmails` is a second lock, checked by `local-server.js` after Supabase
has confirmed the token: only these addresses are given a console session. Leave
it as `[]` and any confirmed Supabase user may sign in. Keeping Lisa's address
listed means the console stays shut even if sign-ups are ever switched back on
by accident.

## 5. Restart and sign in

```
node local-server.js
```

Open <http://127.0.0.1:8000/admin/> — the sign-in page now asks for an email
address as well as a password. The old local password stops working the moment
`url` and `anonKey` are both filled in.

## How it fits together

1. The browser posts the email and password straight to Supabase
   (`/auth/v1/token?grant_type=password`) and gets an access token back.
2. It hands that token to `local-server.js` at `/api/session`.
3. The server asks Supabase `/auth/v1/user` whether the token is real, unexpired
   and still attached to a live user, then checks `allowedEmails`.
4. Only then does it issue the console's own `spes_session` cookie — the same
   cookie every other route already trusted, so nothing else had to change.

The server never sees your Supabase password, and the browser never gets to
decide for itself whether a token is valid.

## Resetting

- **Forgot the password** — Supabase → Authentication → Users → ⋯ → *Send
  password recovery*, or set a new one directly.
- **Back to the local password** — blank out `url` and `anonKey` in
  `admin/supabase.json` and restart. Delete `admin/auth.json` to reset that
  password; it is rebuilt on the next start from `SPES_ADMIN_PASSWORD`.

## A note on hosting

`local-server.js` is a Node server and runs on your computer. Vercel serves this
project as static files, so the console is not reachable from the published
site — Supabase sign-in does not change that. Editing pages from the live site
would mean moving the page content and media into Supabase too, which is a
larger piece of work.
