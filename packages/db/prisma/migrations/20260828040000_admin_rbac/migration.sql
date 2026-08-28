-- Task 04: platform-admin role assignments.
-- Role keys are intentionally extensible strings. Application authorization only recognizes registered role keys.
CREATE TABLE "AdminRoleAssignment" (
  "id" UUID NOT NULL,
  "accountId" UUID NOT NULL,
  "role" VARCHAR(64) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdminRoleAssignment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AdminRoleAssignment_accountId_role_key"
  ON "AdminRoleAssignment"("accountId", "role");
CREATE INDEX "AdminRoleAssignment_accountId_idx"
  ON "AdminRoleAssignment"("accountId");
CREATE INDEX "AdminRoleAssignment_role_createdAt_idx"
  ON "AdminRoleAssignment"("role", "createdAt");

ALTER TABLE "AdminRoleAssignment"
  ADD CONSTRAINT "AdminRoleAssignment_role_format_check"
  CHECK ("role" ~ '^[A-Z][A-Z0-9_]{1,63}$');

ALTER TABLE "AdminRoleAssignment"
  ADD CONSTRAINT "AdminRoleAssignment_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
