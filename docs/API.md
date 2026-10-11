# MyBrainBud API Documentation

## Table of Contents

1. [Overview](#1-overview)
2. [Getting Started](#2-getting-started)
3. [Authentication](#3-authentication)
4. [API Endpoints](#4-api-endpoints)
5. [Error Handling](#5-error-handling)
6. [Data Models](#6-data-models)
7. [API Status](#7-api-status)
8. [Recommended Next Steps](#8-recommended-next-steps)

---

> **Postman Collection:** A ready-to-import Postman collection with all
> authentication endpoints, auto token capture, and example request bodies is
> available at
> [`docs/MyBrainBud_Auth.postman_collection.json`](./MyBrainBud_Auth.postman_collection.json).
> In Postman, use **Import → File** to load it, then run the requests in the
> `Authentication` folder in order.

---

## 1. Overview

### What is MyBrainBud?

MyBrainBud is a REST API backend for an AI-powered Nigerian exam preparation platform. The system is designed to help students prepare for national examinations including BECE, WAEC, NECO, and JAMB through intelligent diagnostic assessments, personalized learning pathways, and AI tutoring.

### Technology Stack

| Component | Technology |
|-----------|------------|
| Runtime | Node.js |
| Framework | Express.js |
| Language | TypeScript |
| Database | PostgreSQL (via Prisma ORM) |
| Authentication | JWT (JSON Web Tokens) |
| Validation | Zod |
| Rate Limiting | express-rate-limit |

### API Version

**Current Version: 1.1.0**

### Base URLs

| Environment | URL |
|-------------|-----|
| Development | `http://localhost:5000` |
| Production | `https://api.mybrainbud.com` |

### Content Type

All API requests and responses use JSON format:

```
Content-Type: application/json
```

---

## 2. Getting Started

### Prerequisites

- Node.js 18+ installed
- PostgreSQL database (Neon, Supabase, or local)
- Valid `DATABASE_URL` environment variable

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd mybrainbud-backend

# Install dependencies
npm install

# Generate Prisma Client
npx prisma generate

# Apply database migrations
npx prisma migrate deploy

# Start development server
npm run dev
```

### Environment Variables

Create a `.env` file based on `.env.example`:

```bash
NODE_ENV=development
PORT=5000
DATABASE_URL=postgresql://user:password@host:5432/dbname?sslmode=require
JWT_ACCESS_SECRET=your-jwt-access-secret-min-32-chars
JWT_REFRESH_SECRET=your-jwt-refresh-secret-min-32-chars
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d
CORS_ORIGIN=http://localhost:3000

# Google Sign-In
# ID-token flow (POST /api/auth/google) needs the client id:
GOOGLE_CLIENT_ID=
# OAuth 2.0 redirect flow (GET /api/auth/google -> /google/callback) also needs:
GOOGLE_CLIENT_SECRET=
GOOGLE_CALLBACK_URL=https://api.example.com/api/auth/google/callback
# Frontend origin used for post-OAuth browser redirects (falls back to CORS_ORIGIN)
FRONTEND_URL=http://localhost:3000
# Optional overrides for the post-flow landing pages (defaults shown)
# GOOGLE_OAUTH_SUCCESS_REDIRECT=http://localhost:3000/auth/callback
# GOOGLE_OAUTH_FAILURE_REDIRECT=http://localhost:3000/login?error=google

# Outbound delivery for OTP codes and password-reset emails
# console (dev only) | webhook (production) | none
EMAIL_DELIVERY_PROVIDER=console
EMAIL_WEBHOOK_URL=
EMAIL_WEBHOOK_TOKEN=

# OTP policy (4-digit code fixed by design)
OTP_EXPIRY_MINUTES=10
OTP_RESEND_COOLDOWN_SECONDS=60
OTP_MAX_ATTEMPTS=5
OTP_MAX_RESENDS_PER_HOUR=5

# Password reset policy
RESET_TOKEN_EXPIRY_MINUTES=30
RESET_TOKEN_MAX_ATTEMPTS=5
```

> **Production note:** with `NODE_ENV=production` the `console` provider is
> refused. Configure `EMAIL_DELIVERY_PROVIDER=webhook` + `EMAIL_WEBHOOK_URL`
> (an endpoint that forwards to your email/SMS provider), otherwise
> registration, resend, and forgot-password fail safely with `503` instead of
> pretending a message was delivered. `CORS_ORIGIN` must be the exact frontend
> origin so credentialed requests and the refresh cookie work.

### Running the Server

```bash
# Development
npm run dev

# Production
npm run build
npm start
```

### Health Check

Verify the server is running:

```bash
GET /health
```

Response:
```json
{
  "success": true,
  "service": "mybrainbud-api",
  "status": "healthy"
}
```

---

## 3. Authentication

MyBrainBud uses **JWT (JSON Web Token)** authentication with access and refresh token pattern.

### Authentication Flow

```
┌─────────┐                              ┌─────────────┐
│  User   │                              │    API      │
└────┬────┘                              └──────┬──────┘
     │                                        │
     │  POST /api/auth/register               │
     │  { firstName, email, password,         │
     │    acceptTerms: true }                 │
     │ ─────────────────────────────────────►
     │                                        │
     │   201 { user,                          │
     │     verification: {                    │
     │       destination: "j***@example.com", │
     │       expiresInSeconds: 600 } }        │
     │   (no session yet — OTP was sent)      │
     │ ◄─────────────────────────────────────
     │                                        │
     │  POST /api/auth/verify-otp             │
     │  { email, code: "1234" }               │
     │ ─────────────────────────────────────►
     │                                        │  marks email verified
     │   200 { accessToken, refreshToken,     │  creates session
     │         user: {...} } + Set-Cookie     │
     │ ◄─────────────────────────────────────
     │                                        │
     │  GET /api/auth/me                     │
     │  Authorization: Bearer <accessToken>  │
     │ ─────────────────────────────────────►
     │                                        │
     │   { user: {...} }                     │
     │ ◄─────────────────────────────────────
     │                                        │
     │  (after 15 min)                      │
     │                                        │
     │  POST /api/auth/refresh               │
     │  { refreshToken: "eyJ..." }          │
     │ ─────────────────────────────────────►
     │                                        │
     │   {                                   │
     │     accessToken: "eyJ...",  (new)     │
     │     refreshToken: "eyJ...",  (new)     │
     │   }                                   │
     │ ◄─────────────────────────────────────
```

### Token Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| Access Token Expiry | 15m | JWT access token validity |
| Refresh Token Expiry | 7d | JWT refresh token validity |
| Password Hash Rounds | 12 | bcrypt hashing rounds |

### Authorization Header

For protected endpoints, include the access token:

```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

### Session Management

- Sessions are stored in the database with hashed refresh tokens
- Login, successful OTP verification, and Google sign-in create a new session
- Registration alone never creates a session — verification must complete first
- Refresh tokens are rotated on every refresh; the old session is revoked
- Sessions can be revoked individually (logout) or all at once (logout-all)
- A successful password reset revokes all of the user's sessions
- Sessions expire automatically based on refresh token expiry
- Protected endpoints additionally require `user.isVerified === true`
- The refresh cookie is `HttpOnly`, `SameSite=Strict`, `Path=/`, `Secure`
  (production), with the same max-age as the refresh token (7d by default)

---

## 4. API Endpoints

### 4.1 Health Check

#### GET /health

**Description:** Check API health status

**Authentication:** None required

**Response (200 OK):**
```json
{
  "success": true,
  "service": "mybrainbud-api",
  "status": "healthy"
}
```

---

### 4.2 Authentication Endpoints

#### POST /api/auth/register

**Description:** Register a new user account

**Authentication:** None required

**Rate Limit:** 5 requests per 15 minutes per IP

**Request Body:**
```json
{
  "name": "John Doe",
  "email": "john.doe@example.com",
  "password": "SecurePass@123",
  "confirmPassword": "SecurePass@123",
  "acceptTerms": true,
  "role": "STUDENT"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| name | string | Yes* | Full name (current design); split into firstName/lastName on persist |
| firstName | string | Yes* | Legacy alternative to `name` (kept for backward compatibility) |
| lastName | string | No | Max 100 characters (only used with `firstName`) |
| email | string | Yes | Valid email format; normalized to lowercase |
| password | string | Yes | Min 8 chars, must contain uppercase, lowercase, number, special char |
| confirmPassword | string | No | Must match `password` if sent; frontend-only, never stored |
| acceptTerms | boolean | Yes | Must be `true` (terms/consent checkbox) |
| role | enum | No | STUDENT, PARENT, TEACHER only (default: STUDENT). ADMIN/SCHOOL_ADMIN cannot be created via public registration |

> \* Either `name` **or** `firstName` must be provided. `confirmPassword` is a
> frontend concern and is never stored; unknown fields are stripped by validation.

**Response (201 Created):**
```json
{
  "success": true,
  "message": "Registration successful. Please check your email for the verification code.",
  "data": {
    "user": {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "firstName": "John",
      "lastName": "Doe",
      "email": "john.doe@example.com",
      "role": "STUDENT",
      "isVerified": false,
      "isActive": true
    },
    "verification": {
      "destination": "j***@example.com",
      "expiresInSeconds": 600,
      "resendCooldownSeconds": 60
    }
  }
}
```

> **No tokens are issued at registration.** Complete
> `POST /api/auth/verify-otp` with the emailed 4-digit code to receive the
> session. The code itself is never returned by the API.

**Errors:**
- `400` - Validation error
- `409` - Email already registered

**Side Effects:**
- Creates User record
- Automatically creates associated profile:
  - STUDENT → StudentProfile
  - PARENT → ParentProfile
  - TEACHER → TeacherProfile

---

#### POST /api/auth/login

**Description:** Authenticate user and receive tokens

**Authentication:** None required

**Rate Limit:** 5 requests per 15 minutes per IP

**Request Body:**
```json
{
  "email": "john.doe@example.com",
  "password": "SecurePass@123"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Login successful",
  "data": {
    "user": {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "firstName": "John",
      "lastName": "Doe",
      "email": "john.doe@example.com",
      "role": "STUDENT",
      "isVerified": false,
      "isActive": true
    },
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "expiresIn": 900
  }
}
```

**Cookie:** Sets `refreshToken` as httpOnly cookie

**Errors:**
- `400` - Validation error
- `401` - Invalid credentials
- `429` - Too many requests

---

#### POST /api/auth/refresh

**Description:** Exchange refresh token for new access token

**Authentication:** None required

**Rate Limit:** 5 requests per 15 minutes per IP

**Request Body:**
```json
{
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Token refreshed",
  "data": {
    "user": {...},
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "expiresIn": 900
  }
}
```

**Errors:**
- `401` - Invalid or expired refresh token

---

#### GET /api/auth/me

**Description:** Get current authenticated user's profile

**Authentication:** Required (Bearer token)

**Request Header:**
```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "User retrieved",
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "firstName": "John",
    "lastName": "Doe",
    "email": "john.doe@example.com",
    "role": "STUDENT",
    "isVerified": false,
    "isActive": true
  }
}
```

**Errors:**
- `401` - Unauthorized (invalid or missing token)
- `404` - Session not found

---

#### POST /api/auth/logout

**Description:** Logout current session

**Authentication:** Required (Bearer token)

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Logout successful",
  "data": null
}
```

**Side Effects:**
- Revokes current session
- Clears refreshToken cookie

---

#### POST /api/auth/logout-all

**Description:** Logout all sessions for current user

**Authentication:** Required (Bearer token)

**Response (200 OK):**
```json
{
  "success": true,
  "message": "All sessions logged out successfully",
  "data": null
}
```

**Side Effects:**
- Revokes ALL sessions for the user
- Clears refreshToken cookie

#### POST /api/auth/verify-otp

**Description:** Verify the registration OTP, mark the email verified, and receive the first authenticated session (access + refresh tokens).

**Authentication:** None required

**Rate Limit:** 10 requests per 15 minutes per IP

**Request Body:**
```json
{
  "email": "john.doe@example.com",
  "code": "1234"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| email | string | Yes | Registered email (normalized to lowercase) |
| code | string | Yes | Exactly 4 digits |

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Verification successful",
  "data": {
    "user": {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "firstName": "John",
      "lastName": "Doe",
      "email": "john.doe@example.com",
      "role": "STUDENT",
      "isVerified": true,
      "isActive": true
    },
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "expiresIn": 900
  }
}
```

**Cookie:** Sets `refreshToken` as httpOnly cookie

**Errors:**
- `400` - Validation error (code is not 4 digits)
- `401` - Invalid, expired, already-used, or attempt-exhausted code (single generic message)
- `403` - Account inactive

**Side Effects:**
- Consumes the OTP challenge (single use)
- Sets `user.isVerified = true`
- Creates the authenticated session

> The code is never returned by the API. Codes are stored only as HMAC-SHA256
> hashes (peppered with `JWT_ACCESS_SECRET`). Every failure returns the same
> `401` message so the state of the challenge is not leaked.

---

#### POST /api/auth/resend-otp

**Description:** Resend the registration verification code.

**Authentication:** None required

**Rate Limit:** 5 requests per 15 minutes per IP (plus a 60s per-account cooldown and a 5-per-hour cap, enforced silently)

**Request Body:**
```json
{
  "email": "john.doe@example.com"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "If an account with that email exists, a verification code has been sent.",
  "data": { "cooldownSeconds": 60 }
}
```

**Errors:**
- `400` - Validation error
- `503` - Delivery provider not configured (fails safely; never pretends delivery)

---

#### POST /api/auth/resume-signup

**Description:** Continue an incomplete email signup. A signup is only **complete** once its registration OTP has been verified — until then the account exists but is unverified and holds no session. If a user starts registering and leaves before verifying, this endpoint re-issues the verification code and returns the same verification challenge shape as `register`, so the client can drop them straight back onto the OTP screen to finish where they left off.

**Authentication:** None required

**Rate Limit:** 5 requests per 15 minutes per IP (plus the same 60s per-account cooldown and 5-per-hour cap as resend, enforced silently)

**Request Body:**
```json
{
  "email": "john.doe@example.com"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "If you have an incomplete signup for that email, a new verification code has been sent.",
  "data": {
    "verification": {
      "destination": "j***@example.com",
      "expiresInSeconds": 600,
      "resendCooldownSeconds": 60
    }
  }
}
```

**Errors:**
- `400` - Validation error
- `503` - Delivery provider not configured (fails safely; never pretends delivery)

> The response is intentionally generic and identical whether or not a pending
> signup exists, so it cannot be used to enumerate accounts. The user object is
> never returned and no session is issued — the account is completed only by
> `POST /api/auth/verify-otp`, exactly like the initial registration. Resuming
> simply re-sends the code; complete the flow with `verify-otp`.

> The response is intentionally generic and identical whether or not the account
> exists, so the endpoint cannot be used to discover registered emails. The
> resend cooldown and hourly cap are enforced silently (no new code is issued),
> and issuing a new code supersedes (deletes) the previous active code.

---

#### POST /api/auth/google

**Description:** Sign in (or provision) an account using a Google Identity Services ID token.

**Authentication:** None required

**Rate Limit:** 10 requests per 15 minutes per IP

**Request Body:**
```json
{
  "credential": "eyJhbGciOiJSUzI1NiIsImtpZCI6..."
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| credential | string | Yes | Google ID token (the `credential` field from Google Identity Services) |

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Google sign-in successful",
  "data": {
    "user": {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "firstName": "John",
      "lastName": "Doe",
      "email": "john.doe@example.com",
      "role": "STUDENT",
      "isVerified": true,
      "isActive": true
    },
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "expiresIn": 900
  }
}
```

**Cookie:** Sets `refreshToken` as httpOnly cookie

**Errors:**
- `400` - Validation error
- `401` - Invalid Google credentials (signature, audience, issuer, or expiry failure) or unverified email
- `403` - Email already has a password-based account (not taken over)
- `409` - Account created concurrently by another request
- `503` - `GOOGLE_CLIENT_ID` not configured

> The ID token is verified server-side with `google-auth-library`: signature,
> audience (`GOOGLE_CLIENT_ID`), issuer, and expiry are validated, and
> `email_verified` must be true. Google **access tokens** are not accepted, and a
> client-supplied email is never trusted. First-time sign-ins create a verified
> `STUDENT` with a `StudentProfile`; existing Google accounts are signed in
> without creating duplicates.

---

#### GET /api/auth/google

**Description:** Begin the Google OAuth 2.0 redirect (authorization-code) flow. Redirects the browser to Google's consent screen.

**Authentication:** None required

**Rate Limit:** 10 requests per 15 minutes per IP

**Query Parameters:** None

**Behavior:**
1. Mints a random CSRF `state`, stores it in a short-lived (10-minute) HttpOnly `google_oauth_state` cookie, and includes it in the authorization request.
2. Responds with a `302` redirect to Google's consent screen (`Location` header). Requested scopes: `openid`, `email`, `profile`.

**Response (302 Found):** Redirects to `https://accounts.google.com/o/oauth2/v2/auth?...`.

**Errors:**
- `503` - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, or `GOOGLE_CALLBACK_URL` not configured

> This endpoint is meant to be opened in a **browser** — it drives a full
> redirect round-trip through Google. `GOOGLE_CALLBACK_URL` must exactly match an
> Authorized redirect URI configured on your Google Cloud OAuth 2.0 client.

---

#### GET /api/auth/google/callback

**Description:** Google redirects the browser here after the user consents (or denies). Completes the OAuth 2.0 redirect flow and issues a session.

**Authentication:** None required (uses the `google_oauth_state` cookie + Google's `code`)

**Rate Limit:** 10 requests per 15 minutes per IP

**Query Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| code | string | Yes* | One-time authorization code from Google (*required on success) |
| state | string | Yes | Must match the `google_oauth_state` cookie (CSRF check) |
| error | string | No | Present when the user denied consent (e.g. `access_denied`) |

**Behavior:**
1. Validates `state` against the `google_oauth_state` cookie (single-use; cleared immediately).
2. Exchanges the `code` for tokens and verifies the returned ID token exactly like the ID-token flow (signature, audience, issuer, expiry, `email_verified`).
3. Creates a session (or provisions a verified `STUDENT` on first sign-in) and sets the `refreshToken` HttpOnly cookie.
4. Redirects (`302`) to the frontend success page with `?accessToken=...&expiresIn=...`.

**Response (302 Found):** Redirects to the frontend success page (`GOOGLE_OAUTH_SUCCESS_REDIRECT`, default `<FRONTEND_URL>/auth/callback`) with the access token in the query string. On failure — denied consent, invalid/expired `state`, or a code-exchange error — it redirects to the failure page (`GOOGLE_OAUTH_FAILURE_REDIRECT`, default `<FRONTEND_URL>/login?error=google`).

**Errors:** Redirect-based failures do not return JSON; the browser is redirected to the frontend failure page instead.

---

#### POST /api/auth/forgot-password

**Description:** Request a single-use password reset token delivered by email.

**Authentication:** None required

**Rate Limit:** 5 requests per 15 minutes per IP

**Request Body:**
```json
{
  "email": "john.doe@example.com"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "If an account with that email exists, a password reset link has been sent."
}
```

**Errors:**
- `400` - Validation error
- `503` - Delivery provider not configured

> Always returns the same response whether or not the account exists (safe from
> enumeration). Tokens are 256-bit random values stored only as SHA-256 hashes,
> expire after 30 minutes, and are single-use. The token is delivered by email
> only — it is never logged or returned in the response.

---

#### POST /api/auth/reset-password

**Description:** Consume a reset token and set a new password.

**Authentication:** None required

**Rate Limit:** 5 requests per 15 minutes per IP

**Request Body:**
```json
{
  "token": "9f8c...reset-token...",
  "password": "NewSecurePass@123"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| token | string | Yes | The reset token from the email |
| password | string | Yes | New password (same strength policy as registration) |

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Password has been reset successfully. Please sign in with your new password."
}
```

**Errors:**
- `400` - Validation error or invalid/expired/reused token
- `429` - Too many requests

**Side Effects:**
- Re-hashes the password with bcrypt (12 rounds)
- Marks the reset token used (single use)
- Revokes **all** of the user's active sessions

---

## 5. Error Handling

### Error Response Format

All errors follow a consistent format:

```json
{
  "success": false,
  "message": "Human-readable error message",
  "errors": [
    { "field": "email", "message": "Invalid email address" }
  ]
}
```

### HTTP Status Codes

| Code | Status | Description |
|------|--------|-------------|
| 200 | OK | Request succeeded |
| 201 | Created | Resource created successfully |
| 400 | Bad Request | Validation error or malformed request |
| 401 | Unauthorized | Invalid or missing authentication |
| 403 | Forbidden | Insufficient permissions |
| 404 | Not Found | Resource not found |
| 409 | Conflict | Duplicate resource (e.g., email already exists) |
| 422 | Unprocessable Entity | Well-formed but semantically invalid |
| 429 | Too Many Requests | Rate limit exceeded |
| 500 | Internal Server Error | Unexpected server error |

### Validation Errors (400)

```json
{
  "success": false,
  "message": "Validation failed",
  "errors": [
    { "field": "password", "message": "Password must contain at least one uppercase letter" },
    { "field": "email", "message": "Invalid email address" }
  ]
}
```

### Authentication Errors (401)

```json
{
  "success": false,
  "message": "Access token has expired. Please refresh your session."
}
```

### Rate Limiting (429)

```json
{
  "success": false,
  "message": "Too many authentication attempts, please try again later."
}
```

---

## 6. Data Models

### User Model

```typescript
interface User {
  id: string;           // Short app-generated id (6-char base62), not a UUID
  email: string | null; // Unique
  phone: string | null; // Unique
  firstName: string;
  lastName: string | null;
  role: 'STUDENT' | 'PARENT' | 'TEACHER' | 'SCHOOL_ADMIN' | 'ADMIN';
  authProvider: 'EMAIL' | 'PHONE' | 'GOOGLE' | null;
  isVerified: boolean;
  isActive: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
```

> **User IDs** are short, human-friendly, app-generated keys (6 characters,
> base62: `A-Z a-z 0-9`) rather than database UUIDs. The application generates
> the id on account creation and retries on the rare collision. The `id` is a
> primary key and is never derived from PII. (The `Session.id` remains a UUID.)

### Profile Relationships

```
User (role: STUDENT)
  └── StudentProfile
        ├── StudentSubject[]
        ├── AcademicGoal[]
        ├── Assessment[]
        ├── ConceptMastery[]
        ├── LearningGap[]
        └── LearningPath[]

User (role: PARENT)
  └── ParentProfile
        └── ParentStudentLink[] → StudentProfile

User (role: TEACHER)
  └── TeacherProfile
        └── school: School

User (role: SCHOOL_ADMIN)
  └── SchoolAdmin
        └── school: School
```

### Session Model

```typescript
interface Session {
  id: string;        // UUID
  userId: string;
  tokenHash: string; // SHA-256 hash of refresh token
  expiresAt: Date;
  createdAt: Date;
  revokedAt: Date | null;
}
```

### Supported Enums

| Enum | Values |
|------|--------|
| UserRole | STUDENT, PARENT, TEACHER, SCHOOL_ADMIN, ADMIN |
| AuthProvider | EMAIL, PHONE, GOOGLE |
| Gender | MALE, FEMALE, OTHER, PREFER_NOT_TO_SAY |
| ClassLevel | JSS1, JSS2, JSS3, SS1, SS2, SS3 |
| ExamType | BECE, WAEC, NECO, JAMB |
| GoalType | TARGET_SCORE, IMPROVEMENT, EXAM_READINESS, MASTERY |

---

## 7. API Status

### Implemented Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | /health | No | Health check |
| POST | /api/auth/register | No | User registration (sends OTP) |
| POST | /api/auth/login | No | User login |
| POST | /api/auth/verify-otp | No | Verify registration OTP, issue first session |
| POST | /api/auth/resend-otp | No | Resend registration OTP |
| POST | /api/auth/resume-signup | No | Continue an incomplete signup (re-issue OTP) |
| POST | /api/auth/google | No | Google sign-in via ID token |
| GET | /api/auth/google | No | Start Google OAuth 2.0 redirect flow |
| GET | /api/auth/google/callback | No | Complete Google OAuth 2.0 redirect flow |
| POST | /api/auth/refresh | No | Refresh tokens (rotating) |
| GET | /api/auth/me | Yes | Get current user |
| POST | /api/auth/logout | Yes | Logout current session |
| POST | /api/auth/logout-all | Yes | Logout all sessions |
| POST | /api/auth/forgot-password | No | Request a password reset token |
| POST | /api/auth/reset-password | No | Consume reset token, set new password |

### Partially Implemented

The following features have schemas and models defined but no API endpoints:

- **Student Profile Management** - StudentProfile model exists but no dedicated endpoints
- **Subject Management** - Subject model exists but no endpoints
- **Academic Goals** - AcademicGoal model exists but no endpoints
- **Assessment Engine** - Question, Assessment, StudentResponse models exist but no endpoints
- **Learning Gaps** - LearningGap model exists but no endpoints
- **Learning Paths** - LearningPath model exists but no endpoints
- **AI Tutor** - TutorSession model exists but no endpoints
- **Notifications** - Notification model exists but no endpoints
- **Billing/Subscriptions** - Subscription, Payment, Plan models exist but no endpoints
- **School Management** - School, SchoolAdmin, TeacherProfile models exist but no endpoints
- **Parent Linking** - ParentStudentLink model exists but no endpoints

### Planned (Not Yet Implemented)

Based on the Prisma schema and PRD comments, the following features are planned:

- **EP-02: Diagnostic Assessment Engine** - Question generation, adaptive testing
- **EP-03: Curriculum Intelligence Engine** - Concept mastery tracking
- **EP-04: Root Cause Analysis Engine** - Gap root cause analysis
- **EP-05: Personalised Learning Pathways** - AI-generated learning paths
- **EP-06: Curriculum Knowledge Graph** - Neo4j-based concept relationships
- **EP-07: AI Learning Tutor** - GPT-powered tutoring sessions
- **EP-08: Progress & Mastery Tracking** - Streaks, snapshots, analytics
- **EP-09: Exam Readiness Intelligence** - Prediction and risk alerts
- **EP-10: Teacher Tools** - Content management, misconception flagging
- **EP-11: Notifications** - Push, WhatsApp, email reminders
- **EP-12: Monetization** - Subscriptions, payments, referrals

---

## 8. Recommended Next Steps

Based on the current implementation and planned features, the following API endpoints are recommended:

### High Priority

1. **Student Profile APIs**
   - `GET /api/students/profile` - Get student profile
   - `PATCH /api/students/profile` - Update profile (classLevel, gender, school, targetExam)
   - `GET /api/students/subjects` - Get student's subjects
   - `POST /api/students/subjects` - Add subject to student

2. **Subject APIs**
   - `GET /api/subjects` - List all subjects
   - `GET /api/subjects/:id` - Get subject details

3. **Academic Goals APIs**
   - `GET /api/goals` - List student's goals
   - `POST /api/goals` - Create a goal
   - `PATCH /api/goals/:id` - Update goal
   - `DELETE /api/goals/:id` - Deactivate goal

### Medium Priority

4. **Parent-Student Linking**
   - `POST /api/parents/link` - Link student to parent
   - `GET /api/parents/students` - Get linked students
   - `DELETE /api/parents/students/:id` - Unlink student

5. **School Management**
   - `POST /api/schools` - Create school
   - `GET /api/schools/:id` - Get school details
   - `GET /api/schools/:id/teachers` - List school teachers

6. **Teacher Endpoints**
   - `GET /api/teachers/students` - Get assigned students
   - `POST /api/teachers/misconceptions` - Report misconception

### Lower Priority

7. **Assessment & Diagnostic APIs**
   - `POST /api/assessments/start` - Start diagnostic assessment
   - `POST /api/assessments/:id/questions` - Get next question
   - `POST /api/assessments/:id/respond` - Submit response
   - `GET /api/assessments/:id/results` - Get assessment results

8. **Learning Path APIs**
   - `GET /api/learning-path` - Get student's learning path
   - `POST /api/learning-path/:stepId/complete` - Mark step complete

9. **AI Tutor APIs**
   - `POST /api/tutor/sessions` - Start tutor session
   - `POST /api/tutor/sessions/:id/messages` - Send message
   - `GET /api/tutor/sessions/:id` - Get session history

---

## Appendix A: User Roles & Permissions

| Role | Description |
|------|-------------|
| STUDENT | Default role for learners |
| PARENT | Guardian who can monitor student progress |
| TEACHER | Educational content provider |
| SCHOOL_ADMIN | Manages school accounts and teachers |
| ADMIN | Full system access |

## Appendix B: Rate Limiting

Authentication endpoints are protected by rate limiting:

| Endpoint | Limit | Window |
|----------|-------|--------|
| POST /api/auth/login | 5 requests | 15 minutes |
| POST /api/auth/register | 5 requests | 15 minutes |
| POST /api/auth/refresh | 5 requests | 15 minutes |
| POST /api/auth/verify-otp | 10 requests | 15 minutes |
| POST /api/auth/resend-otp | 5 requests | 15 minutes |
| POST /api/auth/resume-signup | 5 requests | 15 minutes |
| POST /api/auth/google | 10 requests | 15 minutes |
| GET /api/auth/google | 10 requests | 15 minutes |
| GET /api/auth/google/callback | 10 requests | 15 minutes |
| POST /api/auth/forgot-password | 5 requests | 15 minutes |
| POST /api/auth/reset-password | 5 requests | 15 minutes |

## Appendix C: Password Requirements

Passwords must meet ALL of the following criteria:

- Minimum 8 characters
- At least one uppercase letter (A-Z)
- At least one lowercase letter (a-z)
- At least one number (0-9)
- At least one special character (!@#$%^&* etc.)

---

*Document Version: 1.1.0*
*Last Updated: 2026-10-09*
