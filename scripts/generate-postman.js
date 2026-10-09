// Generates docs/MyBrainBud_Auth.postman_collection.json (Postman Collection v2.1)
// Run with: node scripts/generate-postman.js
const { writeFileSync, mkdirSync } = require("node:fs");
const { dirname, join } = require("node:path");

const here = __dirname;
const outPath = join(here, "..", "docs", "MyBrainBud_Auth.postman_collection.json");


const captureTokens = [
  "// Auto-capture tokens so chained requests (e.g. /me) work immediately.",
  "if (pm.response.code === 200 || pm.response.code === 201) {",
  "  const json = pm.response.json();",
  "  if (json && json.data && json.data.accessToken) {",
  "    pm.collectionVariables.set('accessToken', json.data.accessToken);",
  "    pm.collectionVariables.set('refreshToken', json.data.refreshToken);",
  "  }",
  "}",
].join("\n");

// Helper to build a request item.
function req(name, method, path, opts = {}) {
  const { desc = "", auth = false, body = null, test = null, note = "" } = opts;
  const header = [{ key: "Content-Type", value: "application/json" }];
  if (auth) header.push({ key: "Authorization", value: "Bearer {{accessToken}}" });

  const item = {
    name,
    request: {
      method,
      header,
      url: {
        raw: "{{baseUrl}}" + path,
        host: ["{{baseUrl}}"],
        path: path.split("/").filter(Boolean),
      },
    },
  };
  if (desc) item.request.description = desc;
  if (body) {
    item.request.body = {
      mode: "raw",
      raw: JSON.stringify(body, null, 2),
      options: { raw: { language: "json" } },
    };
  }
  const events = [];
  if (test) events.push({ listen: "test", script: { type: "text/javascript", exec: test.split("\n") } });
  if (events.length) item.event = events;
  if (note) item.request.description = (desc ? desc + "\n\n" : "") + note;
  return item;
}

const collection = {
  info: {
    name: "MyBrainBud Authentication API",
    description:
      "Authentication endpoints for the MyBrainBud backend (v1.1.0).\n\n" +
      "Covers the registration -> OTP verification -> session journey, login, " +
      "Google sign-in, password reset, and session management.\n\n" +
      "SETUP:\n" +
      "1. Set `baseUrl` (defaults to http://localhost:5000).\n" +
      "2. Start the server (npm start) and run the Prisma migration.\n" +
      "3. Run the requests in order inside the 'Authentication' folder.\n" +
      "   The access/refresh tokens are captured automatically after\n" +
      "   register, verify-otp, login, google, and refresh, so /me, logout\n" +
      "   and logout-all work without manual copy/paste.\n\n" +
      "NOTES:\n" +
      "- The refresh token is also set as an HttpOnly cookie by the server.\n" +
      "  For cookie-based testing, use Postman's cookie jar / a browser.\n" +
      "- Registration returns NO tokens; verify the OTP first. The code is\n" +
      "  only delivered by email (never returned by the API). In development\n" +
      "  with EMAIL_DELIVERY_PROVIDER=console, read the code from the server log.\n" +
      "- Rate limits: most endpoints 5 req / 15 min / IP; verify-otp and\n" +
      "  google 10 req / 15 min / IP.",
    schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
  },
  variable: [
    { key: "baseUrl", value: "http://localhost:5000" },
    { key: "accessToken", value: "" },
    { key: "refreshToken", value: "" },
    { key: "testEmail", value: "postman.test@example.com" },
    { key: "testPassword", value: "SecurePass@123" },
    { key: "googleCredential", value: "" },
    { key: "resetToken", value: "" },
  ],
  item: [],
};

const healthItem = {
  name: "Health",
  item: [
    req("GET /health", "GET", "/health", {
      desc:
        "Check API health status.\n\n" +
        "Returns 200 with `{ success, service, status }`.",
      test:
        "pm.test('status is 200', () => pm.response.to.have.status(200));\n" +
        "pm.test('service is mybrainbud-api', () => pm.expect(pm.response.json().service).to.eql('mybrainbud-api'));",
    }),
  ],
};

const authItems = [];


authItems.push(
  req("POST /api/auth/register", "POST", "/api/auth/register", {
    desc:
      "Register a new account.\n\n" +
      "- Creates the user + role-specific profile transactionally. The single\n" +
      "  `name` field from the design is split into firstName/lastName on persist.\n" +
      "- Issues NO tokens. An OTP challenge is created and the 4-digit code is delivered by email. Verification is required to obtain a session.\n" +
      "- acceptTerms must be true. role may only be STUDENT, PARENT, or TEACHER via public registration (ADMIN/SCHOOL_ADMIN are rejected).\n\n" +
      "Rate limit: 5 req / 15 min / IP.\n\n" +
      "Responses: 201 (created) | 400 (validation) | 409 (email exists) | 503 (no delivery provider).",
    body: {
      name: "John Doe",
      email: "{{testEmail}}",
      password: "{{testPassword}}",
      confirmPassword: "{{testPassword}}",
      acceptTerms: true,
      role: "STUDENT",
    },
    test:
      captureTokens +
      "\npm.test('status is 201', () => pm.response.to.have.status(201));\npm.test('no tokens issued at registration', () => pm.expect(pm.response.json().data.accessToken).to.be.undefined);",
  }),
  req("POST /api/auth/verify-otp", "POST", "/api/auth/verify-otp", {
    desc:
      "Verify the registration OTP.\n\n" +
      "- Consumes the 4-digit challenge (single use), marks the email verified, and issues the first authenticated session (access + refresh tokens).\n" +
      "- Paste the code from the email (or the server log in development) into code.\n\n" +
      "Rate limit: 10 req / 15 min / IP. Per-code attempt limit enforced server-side.\n\n" +
      "Responses: 200 | 400 (code not 4 digits) | 401 (invalid/expired/used/exhausted) | 403 (inactive account).",
    body: { email: "{{testEmail}}", code: "1234" },
    test: captureTokens + "\npm.test('status is 200', () => pm.response.to.have.status(200));",
  }),
  req("POST /api/auth/resend-otp", "POST", "/api/auth/resend-otp", {
    desc:
      "Resend the registration verification code.\n\n" +
      "- Always returns a generic response so it cannot be used to discover whether an account exists.\n" +
      "- A 60s per-account cooldown and 5/hour cap are enforced silently. Issuing a new code supersedes the previous one.\n\n" +
      "Rate limit: 5 req / 15 min / IP.\n\n" +
      "Responses: 200 (generic) | 400 (validation) | 503 (no delivery provider).",
    body: { email: "{{testEmail}}" },
  })
);

authItems.push(
  req("POST /api/auth/login", "POST", "/api/auth/login", {
    desc:
      "Authenticate with email + password.\n\n" +
      "Rate limit: 5 req / 15 min / IP.\n\n" +
      "Responses: 200 | 400 (validation) | 401 (invalid credentials) | 403 (account unverified or inactive) | 429 (rate limit).",
    body: { email: "{{testEmail}}", password: "{{testPassword}}" },
    test: captureTokens + "\npm.test('status is 200', () => pm.response.to.have.status(200));",
  }),
  req("POST /api/auth/google", "POST", "/api/auth/google", {
    desc:
      "Sign in with a Google Identity Services ID token.\n\n" +
      "- The credential is the ID token from Google Identity Services (the credential field in the GIS response). It is verified server-side (signature, audience, issuer, expiry, email_verified).\n" +
      "- Existing password-based accounts are NOT taken over (403).\n\n" +
      "Rate limit: 10 req / 15 min / IP.\n\n" +
      "Responses: 200 | 400 | 401 (invalid token / unverified email) | 403 (password account exists) | 409 (race) | 503 (GOOGLE_CLIENT_ID not set).",
    body: { credential: "{{googleCredential}}" },
    test: captureTokens,
  }),
  req("POST /api/auth/refresh", "POST", "/api/auth/refresh", {
    desc:
      "Exchange a refresh token for a new access + refresh token pair (rotation).\n\n" +
      "- The token may be supplied in the body OR via the HttpOnly refreshToken cookie (the controller falls back to the cookie).\n" +
      "- Refresh tokens are rotated on every call; replaying a rotated token is rejected.\n\n" +
      "Rate limit: 5 req / 15 min / IP.\n\n" +
      "Responses: 200 | 400 (missing token) | 401 (invalid/expired/revoked).",
    body: { refreshToken: "{{refreshToken}}" },
    test: captureTokens + "\npm.test('status is 200', () => pm.response.to.have.status(200));",
  })
);


authItems.push(
  req("GET /api/auth/me", "GET", "/api/auth/me", {
    desc: "Get the currently authenticated user. Requires a valid access token.",
    auth: true,
    test:
      "pm.test('status is 200', () => pm.response.to.have.status(200));\npm.test('returns a user id', () => pm.expect(pm.response.json().data.id).to.be.a('string'));",
  }),
  req("POST /api/auth/logout", "POST", "/api/auth/logout", {
    desc: "Revoke the current session and clear the refresh cookie. Requires auth.",
    auth: true,
    test: "pm.test('status is 200', () => pm.response.to.have.status(200));",
  }),
  req("POST /api/auth/logout-all", "POST", "/api/auth/logout-all", {
    desc: "Revoke ALL sessions for the authenticated user and clear the refresh cookie. Requires auth.",
    auth: true,
    test: "pm.test('status is 200', () => pm.response.to.have.status(200));",
  }),
  req("POST /api/auth/forgot-password", "POST", "/api/auth/forgot-password", {
    desc:
      "Request a single-use password reset token (delivered by email).\n\n" +
      "- Always returns the same generic response regardless of whether the account exists (enumeration-safe).\n" +
      "- Tokens are 256-bit random values, stored only as SHA-256 hashes, and expire after 30 minutes.\n\n" +
      "Rate limit: 5 req / 15 min / IP.\n\n" +
      "Responses: 200 (generic) | 400 (validation) | 503 (no delivery provider).",
    body: { email: "{{testEmail}}" },
  }),
  req("POST /api/auth/reset-password", "POST", "/api/auth/reset-password", {
    desc:
      "Consume a reset token and set a new password.\n\n" +
      "- Re-hashes the password with bcrypt (12 rounds), marks the token used (single use), and revokes ALL of the user's active sessions.\n" +
      "- Paste the token from the reset email into token.\n\n" +
      "Rate limit: 5 req / 15 min / IP.\n\n" +
      "Responses: 200 | 400 (validation or invalid/expired/reused token) | 429 (rate limit).",
    body: { token: "{{resetToken}}", password: "NewSecurePass@456" },
  })
);

collection.item.push(healthItem, { name: "Authentication", item: authItems });

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(collection, null, 2) + "\n", "utf8");
console.log("Wrote " + outPath);

