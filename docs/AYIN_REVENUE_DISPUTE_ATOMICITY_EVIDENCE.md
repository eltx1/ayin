# Creator revenue dispute audit atomicity candidate

Review of the existing Creator monetization workflow found that dispute creation committed before its audit insert. If that audit insert failed, the API failed after committing a dispute, leaving an unaudited row and an ambiguous outcome that the old UI could replay.

The existing parameterized repository insert accepts the transaction's query client. The service creates the dispute and its audit in one existing Prisma transaction. Existing ownership, payout-target validation, schema/Origin/auth boundaries and notification behavior remain intact; notifications still occur after successful service completion. No destination/provider/earnings policy, schema, index or production financial assumption changes.

A new actual AppModule/PostgreSQL integration case installs a narrowly scoped isolated audit failure trigger, exercises the real creator POST, and requires zero disputes, zero matching audit rows and zero opened notifications after failure. It then removes the trigger and requires one dispute and one correlated actor/entity audit after an actual successful request. Trigger/function cleanup is in finally. The existing in-app notification/update journey remains intact.

Local canonical lint/API types and unit verification are recorded with the PR. Actual PostgreSQL CI, full final-head gates, merge and independently downloaded release proof remain pending. This transaction repair does not close Creator/Admin finance UX, uncertain-write review, large-data/concurrent authorization, provider settlement, legal/compliance or the master plan.
