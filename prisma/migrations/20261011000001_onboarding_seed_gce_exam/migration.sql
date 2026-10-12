-- Seed the GCE exam row. Kept in its own migration so the value added by
-- ALTER TYPE ... ADD VALUE 'GCE' has been committed before it is used
-- (PostgreSQL rejects using a fresh enum label inside the same transaction).
INSERT INTO "Exam" ("id", "type", "name")
VALUES ('exam_gce', 'GCE', 'General Certificate of Education (GCE)')
ON CONFLICT DO NOTHING;