# Video advertising command authority — prepared source

Actual settings/override handlers previously passed only an account ID into their audit transactions. Guard checks could precede a credential/configuration/target lock wait; PATCH catch-all handlers also changed later authority or audit failures into400 validation errors.

Settings PATCH and channel/video override PATCH/DELETE now carry the captured authenticated actor into the actual transaction. They explicitly allow AD_MANAGER/Admin/Superadmin, using the held credential, current ACTIVE account/authVersion, actual session/expiry, applicable privileged MFA and step-up checks already used by other Admin write domains. Accounts/TV retain their Operations default and Videos retain their separate Content Moderator scope; adding the explicit advertising role does not grant those domains to AD_MANAGER.

Authority is checked before configuration writes, after channel/video target lock waits, and again after settings/override writes that can wait before the final atomic audit. Real DB session expiry and captured step-up time are rechecked at those points. Existing target rows are held FOR SHARE during override writes. Creation requires an actual target; deletion preserves safe cleanup of existing missing-target overrides and actual deleted:false when no override exists. The override model has no target foreign-key relation, so missing-target cleanup must not be blocked by an invented ownership requirement.

PATCH translates only actual Zod validation failures to the existing400 error. Authority401/403, missing-target404, and genuine final-audit500 retain their correct meaning and cannot be reported as a successful write. No provider is called or activated by this change. Existing configuration defaults, Google IMA decision/policy logic, ad event behavior, and role-specific guard requirements remain.

## Prepared database verification

Twenty-five actual AppModule/PostgreSQL cases are prepared:

-21 observed-lock winners: revoked role/actor/authVersion/session/privileged MFA and expired step-up/real database session, separately for settings PATCH, video override PATCH and DELETE. Each requires complete prior settings/overrides/audits unchanged. Clock cases observe the actual settings upsert or named target lock; other cases observe credential authority waits.
-3 actual final-audit trigger failures return500 with complete config/audit rollback, followed by exactly one explicit successful retry/audit.
-1 scoped AD_MANAGER positive/control-isolation case covers settings and both channel/video override paths, actual Finance denial without facts changing, schema400, missing creation404 and actual missing-target deletion.

These cases are **prepared, not passed** at this checkpoint. Final-head local checks, full migrations/integration/unit/build/security/browser/PWA gates, independent review/source union and matching production proof remain required. Optimistic configuration versions, bounded safe override directory reads and native EN/AR ad UI recovery remain separate required work. This is not whole master, advertising/CMP/legal/provider/device certification.

## Actual first execution and schema reconciliation

Initial 81ab0ac source quality 37155092907 passed 404 API and 490 Web cases, then PostgreSQL reported 815 passing / one failed of 816. All 21 observed authority/time winner cases and three actual audit rollback/retry cases passed. The scoped-role case incorrectly expected an override to survive deletion of its video. Although the Prisma scalar-only model does not declare the relation, migration 20260830001900_video_ad_overrides creates actual cascading target foreign keys. Corrected assertions verify the real override is null after deletion, missing-target upsert is 404 with no config/audit effects, and explicit deletion acknowledges actual deleted:false with one audit. Production constraints are retained. Replacement exact-source gates are required; the first failure is not relabeled as passing.
