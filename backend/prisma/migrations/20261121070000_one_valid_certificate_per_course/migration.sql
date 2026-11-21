-- One person (enrolment id) may hold at most one VALID certificate per course.
-- Revoked certificates do not count, so a cancelled certificate can be issued again later.

ALTER TABLE "certificates" ADD COLUMN "course_code" TEXT;

UPDATE "certificates" c
SET "course_code" = b."course_code"
FROM "batches" b
WHERE b."id" = c."batch_id";

ALTER TABLE "certificates" ALTER COLUMN "course_code" SET NOT NULL;

-- Partial unique index: Postgres itself refuses a second ISSUED certificate for the same
-- enrolment + course, even if two batches are approved at the same moment.
CREATE UNIQUE INDEX "certificates_one_valid_per_enrolment_course"
  ON "certificates" ("enrolment_id", "course_code")
  WHERE "status" = 'ISSUED';
