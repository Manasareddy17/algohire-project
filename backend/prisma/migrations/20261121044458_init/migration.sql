-- CreateEnum
CREATE TYPE "Role" AS ENUM ('CENTRE', 'DISTRICT_OFFICER', 'QUALITY', 'STATE');

-- CreateEnum
CREATE TYPE "BatchStatus" AS ENUM ('DRAFT', 'DISTRICT_REVIEW', 'QUALITY_REVIEW', 'STATE_REVIEW', 'SENT_BACK', 'REJECTED', 'APPROVED');

-- CreateEnum
CREATE TYPE "ReviewStage" AS ENUM ('DISTRICT', 'QUALITY', 'STATE');

-- CreateEnum
CREATE TYPE "ReviewDecision" AS ENUM ('APPROVE', 'SEND_BACK', 'REJECT');

-- CreateEnum
CREATE TYPE "CertificateStatus" AS ENUM ('ISSUED', 'REVOKED');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "districts" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "districts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "training_centres" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "district_id" INTEGER NOT NULL,

    CONSTRAINT "training_centres_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "username" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "district_id" INTEGER,
    "centre_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "batches" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "centre_id" INTEGER NOT NULL,
    "course_code" TEXT NOT NULL,
    "course_name" TEXT NOT NULL,
    "status" "BatchStatus" NOT NULL DEFAULT 'DRAFT',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "stage_entered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "escalated_at" TIMESTAMP(3),
    "send_back_reason" TEXT,
    "submitted_at" TIMESTAMP(3),
    "approved_at" TIMESTAMP(3),
    "created_by_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "candidates" (
    "id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "row_number" INTEGER NOT NULL,
    "enrolment_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "score" INTEGER NOT NULL,

    CONSTRAINT "candidates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "batch_reviews" (
    "id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "stage" "ReviewStage" NOT NULL,
    "reviewer_id" INTEGER NOT NULL,
    "decision" "ReviewDecision" NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "batch_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "certificates" (
    "id" UUID NOT NULL,
    "certificate_no" TEXT NOT NULL,
    "candidate_id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "candidate_name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "enrolment_id" TEXT NOT NULL,
    "course_name" TEXT NOT NULL,
    "centre_name" TEXT NOT NULL,
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "CertificateStatus" NOT NULL DEFAULT 'ISSUED',
    "revoked_at" TIMESTAMP(3),
    "revoked_by_id" INTEGER,
    "revoke_reason" TEXT,
    "pdf_path" TEXT,
    "delivery_status" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "delivery_attempts" INTEGER NOT NULL DEFAULT 0,
    "delivered_at" TIMESTAMP(3),
    "provider_message_id" TEXT,
    "last_delivery_error" TEXT,

    CONSTRAINT "certificates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" BIGSERIAL NOT NULL,
    "actor_id" INTEGER,
    "actor_role" TEXT,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "batch_id" UUID,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "correlation_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "aggregate_type" TEXT NOT NULL,
    "aggregate_id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "correlation_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMP(3),

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "districts_name_key" ON "districts"("name");

-- CreateIndex
CREATE UNIQUE INDEX "training_centres_code_key" ON "training_centres"("code");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "batches_code_key" ON "batches"("code");

-- CreateIndex
CREATE INDEX "batches_status_stage_entered_at_idx" ON "batches"("status", "stage_entered_at");

-- CreateIndex
CREATE INDEX "batches_centre_id_idx" ON "batches"("centre_id");

-- CreateIndex
CREATE UNIQUE INDEX "candidates_batch_id_enrolment_id_key" ON "candidates"("batch_id", "enrolment_id");

-- CreateIndex
CREATE UNIQUE INDEX "candidates_batch_id_phone_key" ON "candidates"("batch_id", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "batch_reviews_batch_id_revision_stage_reviewer_id_key" ON "batch_reviews"("batch_id", "revision", "stage", "reviewer_id");

-- CreateIndex
CREATE UNIQUE INDEX "certificates_certificate_no_key" ON "certificates"("certificate_no");

-- CreateIndex
CREATE UNIQUE INDEX "certificates_candidate_id_key" ON "certificates"("candidate_id");

-- CreateIndex
CREATE INDEX "certificates_batch_id_idx" ON "certificates"("batch_id");

-- CreateIndex
CREATE INDEX "audit_logs_batch_id_created_at_idx" ON "audit_logs"("batch_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "outbox_events_published_at_created_at_idx" ON "outbox_events"("published_at", "created_at");

-- AddForeignKey
ALTER TABLE "training_centres" ADD CONSTRAINT "training_centres_district_id_fkey" FOREIGN KEY ("district_id") REFERENCES "districts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_district_id_fkey" FOREIGN KEY ("district_id") REFERENCES "districts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_centre_id_fkey" FOREIGN KEY ("centre_id") REFERENCES "training_centres"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batches" ADD CONSTRAINT "batches_centre_id_fkey" FOREIGN KEY ("centre_id") REFERENCES "training_centres"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_reviews" ADD CONSTRAINT "batch_reviews_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_reviews" ADD CONSTRAINT "batch_reviews_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "candidates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
