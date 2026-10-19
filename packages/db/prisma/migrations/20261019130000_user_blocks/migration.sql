CREATE TABLE "UserBlock" (
  "blockerAccountId" UUID NOT NULL,
  "blockedAccountId" UUID NOT NULL,
  "publicLabel" VARCHAR(120) NOT NULL,
  "sourceChannelId" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserBlock_pkey" PRIMARY KEY ("blockerAccountId", "blockedAccountId"),
  CONSTRAINT "UserBlock_no_self" CHECK ("blockerAccountId" <> "blockedAccountId"),
  CONSTRAINT "UserBlock_blocker_fkey" FOREIGN KEY ("blockerAccountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "UserBlock_blocked_fkey" FOREIGN KEY ("blockedAccountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "UserBlock_blockedAccountId_blockerAccountId_idx" ON "UserBlock"("blockedAccountId", "blockerAccountId");
