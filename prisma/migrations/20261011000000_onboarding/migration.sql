-- Onboarding flow: exam options now include GCE, students track a study year,
-- and onboarding progress is persisted on the profile.

-- 1. New exam type
ALTER TYPE "ExamType" ADD VALUE IF NOT EXISTS 'GCE';

-- 2. Study year enum + profile columns
CREATE TYPE "StudyYear" AS ENUM ('YEAR_1', 'YEAR_2', 'YEAR_3', 'YEAR_4', 'YEAR_5', 'YEAR_6');

ALTER TABLE "StudentProfile"
  ADD COLUMN IF NOT EXISTS "studyYear" "StudyYear",
  ADD COLUMN IF NOT EXISTS "onboardingComplete" BOOLEAN NOT NULL DEFAULT false;

-- 3. Seed the exams already in ExamType (WAEC, JAMB, NECO).
--    Fixed ids so the migration is idempotent and clients can rely on stable keys.
--    The GCE row is seeded in the follow-up migration because PostgreSQL forbids
--    using a value added by ALTER TYPE in the same transaction.
INSERT INTO "Exam" ("id", "type", "name") VALUES
  ('exam_waec', 'WAEC', 'West African Examinations Council (WAEC)'),
  ('exam_jamb', 'JAMB', 'Joint Admissions and Matriculation Board (JAMB)'),
  ('exam_neco', 'NECO', 'National Examinations Council (NECO)')
ON CONFLICT DO NOTHING;

-- 4. Seed the subjects offered in the onboarding subject step.
INSERT INTO "Subject" ("id", "name", "code", "description", "isActive") VALUES
  ('subj_eng', 'English Language', 'ENG', 'Reading comprehension, grammar, summary writing and essay composition', true),
  ('subj_mat', 'Mathematics',      'MAT', 'Number and notation, algebra, geometry, trigonometry and statistics', true),
  ('subj_csc', 'Computer Studies', 'CSC', 'Computer fundamentals, hardware, software, networking and digital literacy', true),
  ('subj_bio', 'Biology',          'BIO', 'Cell biology, human biology, ecology, genetics and evolution', true),
  ('subj_phy', 'Physics',          'PHY', 'Mechanics, waves, electricity, magnetism and modern physics', true),
  ('subj_che', 'Chemistry',        'CHE', 'Atomic structure, bonding, stoichiometry, acids/bases and organic chemistry', true)
ON CONFLICT DO NOTHING;