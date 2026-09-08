CREATE TYPE "AccountDeletionState" AS ENUM (
  'REQUESTED',
  'GRACE_PERIOD',
  'DEACTIVATED',
  'ANONYMIZED',
  'CANCELLED'
);

CREATE TYPE "PrivacyMediaDeletionKind" AS ENUM ('OBJECT', 'PREFIX');
CREATE TYPE "PrivacyMediaDeletionStatus" AS ENUM ('PENDING', 'PROCESSING', 'DONE', 'FAILED');

CREATE TABLE "AccountDeletionRequest" (
  "id" UUID NOT NULL,
  "accountId" UUID NOT NULL,
  "state" "AccountDeletionState" NOT NULL DEFAULT 'REQUESTED',
  "requestedFromSessionId" UUID,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "graceEndsAt" TIMESTAMP(3),
  "deactivatedAt" TIMESTAMP(3),
  "anonymizedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "mediaCleanupQueuedAt" TIMESTAMP(3),
  "mediaCleanupCompletedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "lifecycleLeaseOwner" VARCHAR(200),
  "lifecycleLeaseUntil" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AccountDeletionRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PrivacyMediaDeletionJob" (
  "id" UUID NOT NULL,
  "requestId" UUID NOT NULL,
  "accountId" UUID NOT NULL,
  "kind" "PrivacyMediaDeletionKind" NOT NULL,
  "target" VARCHAR(1024) NOT NULL,
  "status" "PrivacyMediaDeletionStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "claimedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PrivacyMediaDeletionJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AccountDeletionRequest_one_active_per_account_idx"
ON "AccountDeletionRequest"("accountId")
WHERE "state" IN (
  'REQUESTED'::"AccountDeletionState",
  'GRACE_PERIOD'::"AccountDeletionState",
  'DEACTIVATED'::"AccountDeletionState"
);

CREATE INDEX "AccountDeletionRequest_accountId_createdAt_idx"
ON "AccountDeletionRequest"("accountId", "createdAt");
CREATE INDEX "AccountDeletionRequest_state_graceEndsAt_idx"
ON "AccountDeletionRequest"("state", "graceEndsAt");
CREATE INDEX "AccountDeletionRequest_state_deactivatedAt_idx"
ON "AccountDeletionRequest"("state", "deactivatedAt");
CREATE INDEX "AccountDeletionRequest_lifecycleLeaseUntil_idx"
ON "AccountDeletionRequest"("lifecycleLeaseUntil");

CREATE UNIQUE INDEX "PrivacyMediaDeletionJob_requestId_kind_target_key"
ON "PrivacyMediaDeletionJob"("requestId", "kind", "target");
CREATE INDEX "PrivacyMediaDeletionJob_status_availableAt_createdAt_idx"
ON "PrivacyMediaDeletionJob"("status", "availableAt", "createdAt");
CREATE INDEX "PrivacyMediaDeletionJob_requestId_status_idx"
ON "PrivacyMediaDeletionJob"("requestId", "status");
CREATE INDEX "PrivacyMediaDeletionJob_accountId_createdAt_idx"
ON "PrivacyMediaDeletionJob"("accountId", "createdAt");

ALTER TABLE "AccountDeletionRequest"
ADD CONSTRAINT "AccountDeletionRequest_accountId_fkey"
FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PrivacyMediaDeletionJob"
ADD CONSTRAINT "PrivacyMediaDeletionJob_requestId_fkey"
FOREIGN KEY ("requestId") REFERENCES "AccountDeletionRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PrivacyMediaDeletionJob"
ADD CONSTRAINT "PrivacyMediaDeletionJob_accountId_fkey"
FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
