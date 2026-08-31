from pathlib import Path

schema = Path("packages/db/prisma/schema.prisma")
text = schema.read_text()

account_old = """  communityPosts          CommunityPost[]

  @@index([status, createdAt])"""
account_new = """  communityPosts          CommunityPost[]
  revenueDisputesCreated  RevenueDispute[] @relation(\"RevenueDisputeCreator\")
  revenueDisputesResolved RevenueDispute[] @relation(\"RevenueDisputeResolver\")

  @@index([status, createdAt])"""
if account_old not in text and account_new not in text:
    raise SystemExit("Account relation patch anchor not found")
text = text.replace(account_old, account_new, 1)

channel_old = """  communityPosts     CommunityPost[]

  @@index([status, createdAt])"""
channel_new = """  communityPosts     CommunityPost[]
  payoutProfile      CreatorPayoutProfile?
  revenueDisputes    RevenueDispute[]

  @@index([status, createdAt])"""
if channel_old not in text and channel_new not in text:
    raise SystemExit("Channel relation patch anchor not found")
text = text.replace(channel_old, channel_new, 1)

payout_old = """model Payout {
  id                String       @id @default(uuid()) @db.Uuid
  channelId         String       @db.Uuid
  status            PayoutStatus @default(PENDING)
  amount            Decimal      @db.Decimal(20, 6)
  currency          String       @db.Char(3)
  externalReference String?      @db.VarChar(255)
  requestedAt       DateTime     @default(now())
  processedAt       DateTime?
  paidAt            DateTime?
  failureReason     String?      @db.Text
  createdAt         DateTime     @default(now())
  updatedAt         DateTime     @updatedAt

  channel       Channel               @relation(fields: [channelId], references: [id], onDelete: Restrict)
  ledgerEntries EarningsLedgerEntry[]

  @@index([channelId, status, requestedAt])
  @@index([status, requestedAt])
}"""
payout_new = """model Payout {
  id                String       @id @default(uuid()) @db.Uuid
  channelId         String       @db.Uuid
  status            PayoutStatus @default(PENDING)
  amount            Decimal      @db.Decimal(20, 6)
  currency          String       @db.Char(3)
  externalReference String?      @db.VarChar(255)
  provider          String       @default(\"MANUAL\") @db.VarChar(32)
  requestSource     String       @default(\"ADMIN\") @db.VarChar(16)
  paymentProfileId  String?      @db.Uuid
  requestedAt       DateTime     @default(now())
  processedAt       DateTime?
  paidAt            DateTime?
  failureReason     String?      @db.Text
  createdAt         DateTime     @default(now())
  updatedAt         DateTime     @updatedAt

  channel        Channel               @relation(fields: [channelId], references: [id], onDelete: Restrict)
  paymentProfile CreatorPayoutProfile? @relation(fields: [paymentProfileId], references: [id], onDelete: SetNull)
  ledgerEntries  EarningsLedgerEntry[]
  disputes       RevenueDispute[]

  @@index([channelId, status, requestedAt])
  @@index([status, requestedAt])
  @@index([provider, status, requestedAt])
  @@index([paymentProfileId])
}"""
if payout_old not in text and payout_new not in text:
    raise SystemExit("Payout model patch anchor not found")
text = text.replace(payout_old, payout_new, 1)
schema.write_text(text)

finance = Path("packages/db/prisma/creator-finance.prisma")
ftext = finance.read_text()
profile_anchor = """  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt

  @@index([provider, updatedAt])"""
profile_replacement = """  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt

  channel Channel  @relation(fields: [channelId], references: [id], onDelete: Cascade)
  payouts Payout[]

  @@index([provider, updatedAt])"""
if profile_anchor not in ftext and profile_replacement not in ftext:
    raise SystemExit("CreatorPayoutProfile relation patch anchor not found")
ftext = ftext.replace(profile_anchor, profile_replacement, 1)

dispute_anchor = """  resolvedAt          DateTime?

  @@index([channelId, status, createdAt])"""
dispute_replacement = """  resolvedAt          DateTime?

  channel    Channel  @relation(fields: [channelId], references: [id], onDelete: Cascade)
  payout     Payout?  @relation(fields: [payoutId], references: [id], onDelete: SetNull)
  createdBy  Account  @relation(\"RevenueDisputeCreator\", fields: [createdByAccountId], references: [id], onDelete: Restrict)
  resolvedBy Account? @relation(\"RevenueDisputeResolver\", fields: [resolvedByAccountId], references: [id], onDelete: SetNull)

  @@index([channelId, status, createdAt])"""
if dispute_anchor not in ftext and dispute_replacement not in ftext:
    raise SystemExit("RevenueDispute relation patch anchor not found")
ftext = ftext.replace(dispute_anchor, dispute_replacement, 1)
finance.write_text(ftext)
