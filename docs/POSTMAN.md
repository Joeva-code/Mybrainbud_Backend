# MyBrainBud Authentication API — Postman Collection

A ready-to-import Postman collection (`MyBrainBud_Auth.postman_collection.json`)
covering every authentication endpoint in the MyBrainBud backend (v1.1.0).

## What's included

Two folders:

- **Health** — `GET /health`
- **Authentication** — 14 endpoints:
  - `POST /api/auth/register`
  - `POST /api/auth/verify-otp`
  - `POST /api/auth/resend-otp`
  - `POST /api/auth/resume-signup`
  - `POST /api/auth/login`
  - `POST /api/auth/google`
  - `POST /api/auth/refresh`
  - `GET /api/auth/google`
  - `GET /api/auth/google/callback`
  - `GET /api/auth/me`
  - `POST /api/auth/logout`
  - `POST /api/auth/logout-all`
  - `POST /api/auth/forgot-password`
  - `POST /api/auth/reset-password`

## Import

1. Open Postman → **Import** → select
   `docs/MyBrainBud_Auth.postman_collection.json`.
2. The collection includes variables you can override (eye icon → **Edit**):

| Variable | Default | Purpose |
|----------|---------|---------|
| `baseUrl` | `http://localhost:5000` | API base URL |
| `accessToken` | _(empty)_ | Auto-captured from login/verify/refresh/google |
| `refreshToken` | _(empty)_ | Auto-captured alongside the access token |
| `testEmail` | `postman.test@example.com` | Registration/login email |
| `testPassword` | `SecurePass@123` | Registration/login password |
| `googleCredential` | _(empty)_ | Google Identity Services ID token |
| `resetToken` | _(empty)_ | Token from the reset email |

## Running the journey (recommended order)

Run the `Authentication` folder top-to-bottom:

1. **register** — creates the account and triggers the OTP email. It returns
   **no tokens** (only `user` + `verification`). The request asserts `201`.
2. **verify-otp** — set `code` to the 4-digit code, then send. On success the
   access/refresh tokens are captured automatically. (In development with
   `EMAIL_DELIVERY_PROVIDER=console`, read the code from the server log.)
3. **me / logout / logout-all** — work immediately using the captured token.

> **Token capture:** the register, verify-otp, login, google, and refresh
> requests include a test script that stores `data.accessToken` and
> `data.refreshToken` into collection variables, so downstream requests are
> pre-authorized. `/me`, `/logout`, and `/logout-all` send
> `Authorization: Bearer {{accessToken}}`.

## Important behavior & limits

- **Registration issues no session.** You must verify the OTP first.
- **Left signup incomplete?** `POST /api/auth/resume-signup` re-issues the code
  (same cooldown/caps as resend-otp) and returns the `verification` challenge so
  you can continue where you left off, then finish with `verify-otp`. It is
  enumeration-safe — the response is generic whether or not a pending signup
  exists — and never issues a session.
- **Rate limits:** most endpoints allow **5 requests / 15 min / IP**;
  `verify-otp` and `google` allow **10 / 15 min / IP**. If you hit `429`,
  wait or restart the server (limits are in-memory).
- **OTP codes** are only delivered by email — never returned by the API. In
  development use `EMAIL_DELIVERY_PROVIDER=console` (logged to the server) or
  configure `EMAIL_WEBHOOK_URL`.
- **Google sign-in** has two flows:
  - `POST /api/auth/google` — the Google Identity Services **ID-token** flow
    (button / One-Tap). Paste a real ID token into `googleCredential`; otherwise
    it returns `503`/`401`.
  - `GET /api/auth/google` → `GET /api/auth/google/callback` — the OAuth 2.0
    **redirect (authorization-code)** flow. These return `302` redirects, so in
    Postman turn **off** *Automatically follow redirects* (Settings → General) to
    inspect them. `GET /google` requires `GOOGLE_CLIENT_ID`,
    `GOOGLE_CLIENT_SECRET`, and `GOOGLE_CALLBACK_URL` to be configured (else
    `503`); the callback is normally hit by Google after consent and redirects to
    the frontend with `?accessToken=...&expiresIn=...`.
- **Refresh cookie:** the server also sets an HttpOnly `refreshToken` cookie.
  Postman's script context does not persist cookies the way a browser does, so
  this collection uses the **body** token (`{{refreshToken}}`). For cookie-based
  testing, use Postman's cookie jar or a browser client.

## Regenerating the collection

The file is generated from source to stay in sync with the API. To regenerate
after changing endpoints:

```bash
node scripts/generate-postman.js
```
