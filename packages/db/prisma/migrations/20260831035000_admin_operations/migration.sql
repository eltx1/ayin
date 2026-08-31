CREATE TABLE "SupportTicket" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "createdByAccountId" UUID NOT NULL,
  "assignedToAccountId" UUID,
  "category" VARCHAR(32) NOT NULL,
  "subject" VARCHAR(200) NOT NULL,
  "description" TEXT NOT NULL,
  "priority" VARCHAR(16) NOT NULL DEFAULT 'NORMAL',
  "status" VARCHAR(24) NOT NULL DEFAULT 'OPEN',
  "resolution" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closedAt" TIMESTAMP(3),
  CONSTRAINT "SupportTicket_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SupportTicket_createdByAccountId_fkey" FOREIGN KEY ("createdByAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SupportTicket_assignedToAccountId_fkey" FOREIGN KEY ("assignedToAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "SupportTicket_category_check" CHECK ("category" IN ('GENERAL', 'ACCOUNT', 'CONTENT', 'MONETIZATION', 'ADVERTISING', 'TECHNICAL', 'RIGHTS', 'OTHER')),
  CONSTRAINT "SupportTicket_priority_check" CHECK ("priority" IN ('LOW', 'NORMAL', 'HIGH', 'URGENT')),
  CONSTRAINT "SupportTicket_status_check" CHECK ("status" IN ('OPEN', 'IN_PROGRESS', 'WAITING', 'RESOLVED', 'CLOSED'))
);

CREATE INDEX "SupportTicket_status_priority_createdAt_idx"
  ON "SupportTicket"("status", "priority", "createdAt");
CREATE INDEX "SupportTicket_createdByAccountId_createdAt_idx"
  ON "SupportTicket"("createdByAccountId", "createdAt");
CREATE INDEX "SupportTicket_assignedToAccountId_status_updatedAt_idx"
  ON "SupportTicket"("assignedToAccountId", "status", "updatedAt");
