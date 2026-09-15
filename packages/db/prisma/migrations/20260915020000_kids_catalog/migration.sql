ALTER TABLE "VideoPolicy"
ADD COLUMN "kidsEligible" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "VideoPolicy_kidsEligible_maturityLevel_ageRestriction_idx"
ON "VideoPolicy"("kidsEligible", "maturityLevel", "ageRestriction");
