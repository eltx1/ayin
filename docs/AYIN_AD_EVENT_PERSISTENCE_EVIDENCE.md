# Video ad-event placement concurrency

`VideoAdService.recordEvent` previously used an empty-update placement upsert before creating each event. The locked Prisma 7.10 PostgreSQL adapter can implement that upsert as SELECT followed by INSERT. Concurrent first events for `player_pre_roll` could collide with `AdPlacement_key_key`, return HTTP 500 and never reach event creation. This was observed in the preceding synthetic production-app browser logs and reproduced against an isolated local PostgreSQL database.

The fix preserves the empty update, so recording an event does not rewrite an existing placement's name, configuration, enabled state or updatedAt. Only a real Prisma P2002 whose captured adapter metadata identifies model/table `AdPlacement`, SQLSTATE `23505`, kind `UniqueConstraintViolation` and index `AdPlacement_key_key` is recovered by rereading the exact requested placement key. Missing winners rethrow the original error; failed rereads and unrelated persistence errors still surface. Event creation remains outside the recovery handler.

No event deduplication, accounting, revenue values, eligibility, provider activation, schema or historical data is changed. Repeated identical logical event inputs retain the existing behavior of creating separate event IDs. This narrow recovery is tied to the verified locked adapter metadata; an unrecognized future error shape fails normally rather than being broadly swallowed.

## Local PostgreSQL regression

The suite requires an explicit disposable `TEST_DATABASE_URL`; it does not fall back to `DATABASE_URL`. Two independent Prisma clients issue 32 concurrent service calls. A test-only trigger delays first-placement insertion to expose the SELECT/INSERT window while retaining the real database uniqueness constraint. The trigger is removed after each test.

On unchanged baseline source, 19 of 32 calls rejected with the exact P2002 signature above. The existing-placement and foreign-key tests passed. With the fix, all three tests pass: every concurrent event persists against one placement, an existing disabled placement remains byte-for-byte equivalent including updatedAt, duplicate logical input still creates two distinct events, and an unrelated actual event foreign-key failure remains P2003 with no saved event.

The 17 focused unit cases cover exact collision recovery and rejection of other models, tables, indexes, SQLSTATEs, constraint shapes, plain/forged errors, missing winners, read failures and event-write failures. The local fixture contains synthetic channel/video/event data only. No ad provider is contacted, and this result does not prove delivery, fill, billing or production throughput.

Full API verification passes: 605 unit tests across 113 files, TypeScript checking, production compilation, ESLint and formatting/diff checks. Validation uses an owned filtered `pnpm 11.24.0 install --frozen-lockfile --offline` installation (393 reused packages, zero downloads), regenerated Prisma 7.10 and locally compiled config/types/db packages. The original dependency donor is not modified. The owned PostgreSQL cluster is stopped after both baseline and fixed runs.
