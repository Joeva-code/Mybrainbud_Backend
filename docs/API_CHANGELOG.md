# API Changelog

All notable changes to the MyBrainBud API will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **User IDs are now short, app-generated keys** (6-character base62:
  `A-Z a-z 0-9`) instead of database-generated UUIDs. The `User.id` column
  default was dropped (non-destructive migration — existing rows keep their
  ids); the application now always supplies the id on account creation and
  retries on the rare primary-key collision. Affects every `user.id` returned
  by the API. `Session.id` remains a UUID.

### Added

- `POST /api/auth/resume-signup` — continue an incomplete email signup. A
  signup is only complete once its registration OTP is verified; if a user
  starts registering and leaves before verifying, this re-issues the code and
  returns the same `verification` challenge shape as `register` so the client
  can drop them back on the OTP screen. The response is enumeration-safe
  (generic, identical whether or not a pending account exists) and never issues
  a session — completion still happens via `POST /api/auth/verify-otp`.
- `GET /api/auth/google` — starts the Google OAuth 2.0 **redirect**
  (authorization-code) flow. Mints a CSRF `state` (stored in a short-lived
  HttpOnly `google_oauth_state` cookie) and 302-redirects the browser to Google's
  consent screen. Requires `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and
  `GOOGLE_CALLBACK_URL`; returns `503` when unconfigured.
- `GET /api/auth/google/callback` — completes the redirect flow. Validates
  `state`, exchanges the one-time `code` for tokens, verifies the returned ID
  token (signature/audience/issuer/expiry/`email_verified`), provisions or signs
  in the account, sets the refresh cookie, and 302-redirects to the frontend
  success page with `?accessToken=...&expiresIn=...` (failure redirects to the
  frontend failure page).
- New environment variables for the redirect flow and post-OAuth browser
  redirects: `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL`, `FRONTEND_URL`, and
  optional `GOOGLE_OAUTH_SUCCESS_REDIRECT` / `GOOGLE_OAUTH_FAILURE_REDIRECT`.

### Notes

- Google sign-in now supports **two** flows: the existing Google Identity
  Services ID-token flow (`POST /api/auth/google`) and the new redirect flow
  (`GET /api/auth/google` → `GET /api/auth/google/callback`). Both share the same
  account provisioning/sign-in logic and never take over password-based accounts.
- `GOOGLE_CALLBACK_URL` must exactly match an Authorized redirect URI on your
  Google Cloud OAuth 2.0 client.

## [1.1.0] - 2026-10-09

Authentication release aligning the API with the MyBrainBud Figma
authentication designs (registration → OTP verification → session) and adding
the missing verification, Google sign-in, and password-reset flows.

### Added

- `POST /api/auth/verify-otp` — verifies a 4-digit registration OTP, marks the
  email verified, and issues the first authenticated session (200)
- `POST /api/auth/resend-otp` — resends the registration code with a silent
  cooldown (60s) and hourly cap (5); always returns a generic response
- `POST /api/auth/google` — Google Identity Services ID-token sign-in
  (server-side signature/audience/issuer/expiry/`email_verified` validation via
  `google-auth-library`)
- `POST /api/auth/forgot-password` — enumeration-safe reset request; delivers a
  256-bit single-use token (stored as SHA-256 hash), 30-minute expiry
- `POST /api/auth/reset-password` — consumes the reset token, re-hashes the
  password with bcrypt (12 rounds), and revokes **all** active sessions
- Delivery provider abstraction (`src/services/delivery`) with `console`
  (development only) and `webhook` (production) providers; production fails
  with `503` instead of pretending a message was delivered
- Rate limiting for `verify-otp` / `google` (10 per 15 minutes per IP) and for
  `resend-otp` / `forgot-password` / `reset-password` (5 per 15 minutes per IP)
- Automated test suite (Jest + ts-jest): 83 tests covering registration, OTP,
  login/sessions/refresh, Google sign-in, password reset, validators, and HTTP
  routes

### Changed

- **BREAKING:** `POST /api/auth/register` no longer issues tokens. It now
  requires `acceptTerms: true`, restricts `role` to `STUDENT | PARENT | TEACHER`
  (no more public `ADMIN`/`SCHOOL_ADMIN`), normalizes the email, creates the
  user + role profile in a transaction, creates an OTP challenge, and returns
  `201 { user, verification: { destination, expiresInSeconds, resendCooldownSeconds } }`.
  The session is issued by `POST /api/auth/verify-otp`.
- `POST /api/auth/login` returns `403` for unverified accounts and performs a
  case-insensitive email lookup
- `POST /api/auth/refresh` now also accepts the refresh token from the
  `refreshToken` httpOnly cookie (body remains supported) and re-sets the
  rotated cookie on every refresh
- `authenticate()` middleware additionally requires `user.isVerified`
- Logout cookie clearing now mirrors the cookie attributes used when setting
  (`httpOnly`, `sameSite=strict`, `path=/`, `secure` in production)
- Rate limiters are now instantiated per endpoint (previously one shared
  instance gave login+register+refresh a *combined* budget of 5, contradicting
  the documented per-endpoint limit)

### Fixed

- `ApiError` subclasses now restore the correct prototype chain, so
  `instanceof UnauthorizedError/NotFoundError/...` works as intended
- Registration previously created an active session before any contact
  verification; profile creation was not transactional (orphan risk); duplicate
  accounts could be created with case-variant emails
- Session IDs are generated with `crypto.randomUUID()` instead of the
  `uuid` package (v14 is ESM-only and broke the CommonJS test runner)

### Security

- OTP codes are 4-digit CSPRNG values stored only as HMAC-SHA256 (peppered
  with `JWT_ACCESS_SECRET`); single-use with atomic consumption, 5-attempt cap,
  expiry, supersession, and a generic error message for every failure mode
- Password-reset tokens are 256-bit random values stored only as SHA-256
  hashes, single-use, expiring, and never logged or returned
- Google sign-in never trusts client-supplied emails and refuses to take over
  existing password-based accounts (403)

### Database

- `OtpVerification.purpose` column + `OtpPurpose` enum (`REGISTRATION`),
  composite index on `(destination, purpose)`
- New `PasswordResetToken` model
- Migration: `prisma/migrations/20261009000000_add_otp_purpose_and_password_reset`

---

## [1.0.0] - 2026-08-29

### Added

- Initial API release with authentication endpoints
- Health check endpoint at `/health`
- User registration endpoint at `POST /api/auth/register`
- User login endpoint at `POST /api/auth/login`
- Token refresh endpoint at `POST /api/auth/refresh`
- Get current user endpoint at `GET /api/auth/me`
- Logout current session at `POST /api/auth/logout`
- Logout all sessions at `POST /api/auth/logout-all`

### Features

- JWT-based authentication with access and refresh tokens
- Session management with database-backed sessions
- Role-based user model (STUDENT, PARENT, TEACHER, SCHOOL_ADMIN, ADMIN)
- Automatic profile creation on registration (StudentProfile, ParentProfile, TeacherProfile)
- Password hashing with bcrypt (12 rounds)
- Rate limiting on authentication endpoints (5 requests per 15 minutes)
- Zod validation for all request bodies
- Consistent error response format
- CORS support with configurable origin
- Helmet security headers
- Morgan HTTP request logging
- Cookie parsing for refresh tokens

### Database Models (Prisma Schema)

The following models are defined and ready for migration:

**Core User Models:**
- User
- Session
- OtpVerification

**Educational Content:**
- Subject
- Exam

**Student & Parent:**
- StudentProfile
- StudentSubject
- AcademicGoal
- ParentProfile
- ParentStudentLink

**School:**
- School
- SchoolAdmin
- TeacherProfile
- SchoolLicense
- SchoolEnrollment

**Curriculum (EP-06):**
- ConceptNode
- PrerequisiteEdge
- Misconception
- CurriculumValidation
- GraphDriftFlag
- NigerianContextReference

**Diagnostic Assessment (EP-02):**
- Question
- QuestionOption
- QuestionConcept
- Assessment
- AssessmentQuestion
- StudentResponse

**Curriculum Intelligence (EP-03):**
- ConceptMastery
- LearningGap

**Root Cause Analysis (EP-04):**
- RootCause

**Learning Pathways (EP-05):**
- LearningPath
- LearningPathStep
- ActivityRecommendation

**AI Tutor (EP-07):**
- TutorSession
- TutorMessage
- TutorPracticeSet
- TutorPracticeQuestion

**Progress & Mastery (EP-08):**
- ProgressSnapshot
- GapClosure
- LearningStreak

**Exam Readiness (EP-09):**
- ExamReadiness
- ExamRiskAlert

**Notifications (EP-11):**
- NotificationPreference
- Notification
- ParentWeeklyReport

**Monetization (EP-12):**
- Plan
- Subscription
- Payment
- Invoice
- Referral
- SchoolPurchase

---

## Planned for Future Releases

### [1.2.0] - Planned

- Student profile management endpoints
- Subject listing and management
- Academic goals CRUD operations
- Parent-student linking functionality

### [1.3.0] - Planned

- School management APIs
- Teacher profile and assignment endpoints
- School enrollment and licensing

### [1.4.0] - Planned

- Diagnostic assessment engine endpoints
- Question and assessment management
- Student response tracking

### [2.0.0] - Planned (Major)

- AI-powered learning tutor endpoints
- Personalized learning pathway APIs
- Curriculum knowledge graph integration
- Root cause analysis endpoints
- Exam readiness predictions

---

## Deprecation Policy

When API endpoints or features are deprecated:

1. **Announcement** - Deprecated items will be marked in documentation with a `DEPRECATED` notice
2. **Timeline** - Deprecated features will remain functional for a minimum of 3 months
3. **Removal** - Deprecated features will be removed in the next minor or major version release

---

## Versioning Strategy

- **Major Version (X.0.0)** - Breaking changes to the API
- **Minor Version (x.Y.0)** - New functionality in a backwards-compatible manner
- **Patch Version (x.y.Z)** - Backwards-compatible bug fixes

---

## Migration Guides

When breaking changes are introduced, a migration guide will be provided in the `docs/` directory.

### Migrating to 1.1.0

This release adds a database migration (`OtpPurpose` enum, `OtpVerification.purpose`
column + composite index, and the new `PasswordResetToken` model). Apply it with:

```bash
# 1. Regenerate the Prisma Client with the new schema
npx prisma generate

# 2. Apply pending migrations to your database (non-destructive)
npx prisma migrate deploy
```

New required/optional environment variables to configure are documented in the
1.1.0 entry above and in `.env.example`.

> Registration no longer issues tokens. Update clients to call
> `POST /api/auth/verify-otp` with the emailed 4-digit code to obtain the first
> session. Unverified accounts now receive `403` at login.

### Migrating to 2.0.0

*To be documented when AI tutor features are released.*
