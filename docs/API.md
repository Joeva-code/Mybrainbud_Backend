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

**Current Version: 1.0.0**

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
```

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
     │  POST /api/auth/register              │
     │  or /api/auth/login                   │
     │ ─────────────────────────────────────►
     │                                        │
     │   {                                   │
     │     accessToken: "eyJ...",            │
     │     refreshToken: "eyJ...",           │
     │     user: {...}                       │
     │   }                                   │
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
- Each login/registration creates a new session
- Sessions can be revoked individually (logout) or all at once (logout-all)
- Sessions expire automatically based on refresh token expiry

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
  "firstName": "John",
  "lastName": "Doe",
  "email": "john.doe@example.com",
  "password": "SecurePass@123",
  "role": "STUDENT"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| firstName | string | Yes | 1-100 characters |
| lastName | string | No | Max 100 characters |
| email | string | Yes | Valid email format |
| password | string | Yes | Min 8 chars, must contain uppercase, lowercase, number, special char |
| role | enum | No | STUDENT, PARENT, TEACHER, SCHOOL_ADMIN, ADMIN (default: STUDENT) |

**Response (201 Created):**
```json
{
  "success": true,
  "message": "Registration successful",
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
  id: string;           // UUID
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
| POST | /api/auth/register | No | User registration |
| POST | /api/auth/login | No | User login |
| POST | /api/auth/refresh | No | Refresh tokens |
| GET | /api/auth/me | Yes | Get current user |
| POST | /api/auth/logout | Yes | Logout current session |
| POST | /api/auth/logout-all | Yes | Logout all sessions |

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

## Appendix C: Password Requirements

Passwords must meet ALL of the following criteria:

- Minimum 8 characters
- At least one uppercase letter (A-Z)
- At least one lowercase letter (a-z)
- At least one number (0-9)
- At least one special character (!@#$%^&* etc.)

---

*Document Version: 1.0.0*
*Last Updated: 2026-08-29*
