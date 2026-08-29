# API Changelog

All notable changes to the MyBrainBud API will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

### [1.1.0] - Planned

- Student profile management endpoints
- Subject listing and management
- Academic goals CRUD operations
- Parent-student linking functionality

### [1.2.0] - Planned

- School management APIs
- Teacher profile and assignment endpoints
- School enrollment and licensing

### [1.3.0] - Planned

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

*No migration needed for initial release.*

### Migrating to 2.0.0

*To be documented when AI tutor features are released.*
