ALTER TABLE "Account"
ADD COLUMN "authVersion" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "Account"
ADD CONSTRAINT "Account_authVersion_nonnegative_check"
CHECK ("authVersion" >= 0);
