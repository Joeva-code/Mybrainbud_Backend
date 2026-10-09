# MyBrainBud Backend

AI-Powered Nigerian Exam Preparation Platform - Backend API

## Overview

MyBrainBud is a comprehensive REST API backend for an intelligent learning platform designed to help Nigerian students prepare for BECE, WAEC, NECO, and JAMB examinations through AI-powered diagnostics, personalized learning pathways, and adaptive tutoring.

## Tech Stack

- **Runtime:** Node.js
- **Framework:** Express.js
- **Language:** TypeScript
- **Database:** PostgreSQL (Prisma ORM)
- **Authentication:** JWT
- **Validation:** Zod

## Getting Started

### Prerequisites

- Node.js 18+
- PostgreSQL database

### Installation

```bash
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

Copy `.env.example` to `.env` and configure:

```bash
NODE_ENV=development
PORT=5000
DATABASE_URL=postgresql://user:password@host:5432/dbname?sslmode=require
JWT_ACCESS_SECRET=your-jwt-access-secret
JWT_REFRESH_SECRET=your-jwt-refresh-secret
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server with hot-reload |
| `npm run build` | Compile TypeScript to JavaScript |
| `npm start` | Start production server |
| `npm run lint` | Run ESLint |
| `npm run lint:fix` | Fix ESLint issues |
| `npm test` | Run tests |
| `npm run test:coverage` | Run tests with coverage |

## API Documentation

### Swagger UI

Interactive API documentation is available at:

```
http://localhost:5000/api-docs
```

### Documentation Files

- [API Documentation](./docs/API.md) - Complete API reference
- [OpenAPI Specification](./docs/openapi.yaml) - OpenAPI 3.0 specification
- [API Changelog](./docs/API_CHANGELOG.md) - Version history

### Quick Reference

#### Health Check
```bash
GET /health
```

#### Register
```bash
POST /api/auth/register
Content-Type: application/json

{
  "firstName": "John",
  "email": "john@example.com",
  "password": "SecurePass@123",
  "role": "STUDENT"
}
```

#### Login
```bash
POST /api/auth/login
Content-Type: application/json

{
  "email": "john@example.com",
  "password": "SecurePass@123"
}
```

#### Get Current User
```bash
GET /api/auth/me
Authorization: Bearer <access_token>
```

## Implemented Features

### Authentication
- [x] User registration with role selection
- [x] Email/password login
- [x] JWT access & refresh tokens
- [x] Session management
- [x] Logout (single & all sessions)
- [x] Rate limiting on auth endpoints

### User Roles
- STUDENT (default)
- PARENT
- TEACHER
- SCHOOL_ADMIN
- ADMIN

## Planned Features

The following features are planned for future releases:

- Student profile management
- Subject & exam management
- Academic goals tracking
- Diagnostic assessment engine
- AI learning tutor
- Personalized learning pathways
- Curriculum knowledge graph
- Root cause analysis
- Exam readiness predictions
- Parent dashboard
- School management
- Payment & subscriptions
- Push/WhatsApp notifications

## Project Structure

```
mybrainbud-backend/
├── src/
│   ├── config/
│   │   ├── env.ts        # Environment variables
│   │   └── swagger.ts    # Swagger setup
│   ├── constants/
│   │   └── index.ts     # App constants (roles, error codes)
│   ├── controllers/
│   │   └── auth.controller.ts
│   ├── services/
│   │   └── auth.service.ts
│   ├── middlewares/
│   │   ├── auth.middleware.ts
│   │   ├── error.middleware.ts
│   │   └── role.middleware.ts
│   ├── routes/
│   │   ├── index.ts
│   │   └── auth.routes.ts
│   ├── types/
│   │   ├── index.ts
│   │   └── auth.types.ts
│   ├── utils/
│   │   ├── errors.ts    # Custom error classes
│   │   └── response.ts  # Response helpers
│   ├── validators/
│   │   ├── index.ts     # Validation helpers
│   │   └── auth.validator.ts
│   ├── lib/
│   │   └── prisma.ts    # Prisma client
│   ├── app.ts           # Express app setup
│   └── server.ts        # Server entry point
├── prisma/
│   └── schema.prisma   # Database schema
├── docs/
│   ├── API.md
│   ├── API_CHANGELOG.md
│   └── openapi.yaml
└── ...
```

## License

ISC
