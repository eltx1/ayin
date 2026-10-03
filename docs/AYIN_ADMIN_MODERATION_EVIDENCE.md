# Moderation report queue review

Focused Phase7/12/13/14 work. The complete master phases0–16 remain open.

The actual queue trusted an unchecked generic response, retained old filter/page rows while a different query loaded or failed, had no request deadline/retry, used English-only controls and silently truncated reported comments to120 characters. Its page did not apply the verified client role scope, although backend authorization remained enforced.

The queue now uses the existing validated shared AdminAccessProvider. Account/role changes unmount query state; only SUPERADMIN/ADMIN/OPERATIONS/CONTENT_MODERATOR can issue moderation reads, matching the existing server guard. Privileged MFA, reauthentication and backend role enforcement are unchanged. Existing collection callers remain compatible with the added optional AbortSignal.

Each current page/filter/retry owns an abortable15s read. A query change unmounts the previous snapshot so old rows cannot appear under a new filter or after a failed read. Errors and timeouts present a localized explicit read retry. Known statuses/reasons, UUIDs, dates, bounded25 rows, pagination arithmetic and optional nested targets/cases are validated before rendering. Native disclosure retains complete bounded report/comment/case text. Shared header, select, notices, actions and pagination provide EN/AR rendering with locale-safe Trust & Safety navigation and logical wrapping.

Local boundary tests cover full comments, empty live-queue later pages, wrong query/status/duplicate records, malformed targets/enums/dates, pagination bounds and finance/ads scope. Browser acceptance uses actual AppModule/PostgreSQL reports seeded into isolated local ayin_e2e:31 open reports over two pages, resolved-filter read failure with no stale rows, explicit read retry, complete comment disclosure, EN/AR390 layout, and finance backend403 with zero client queue reads. Exact-head full CI/browser/visual evidence remains pending.

This read-only slice does not certify moderation writes, case assignment, takedown/appeal flows, queue snapshot consistency during concurrent additions, large-data performance, all Admin surfaces or whole master completion.

Predecessor a94a3418 passed full quality/security/inventory. Browser37091963386 passed100/102: both CONTENT_MODERATOR EN/AR fixtures were rejected by the test helper whitelist before page execution. The isolated role fixture now permits the existing server enum CONTENT_MODERATOR; production role/MFA logic is unchanged. Finance denial and the15s stale-read recovery cases passed unchanged. Updated source also incorporates accepted main #171; final-head acceptance remains pending.

Predecessor19dabaf0 passed full quality/security/inventory/browser37092590018 (106 journeys). Downloaded and inspected actual EN/AR390 visual11263216392 SHA256471b31aa1b42c59207baf627d6ea7988362a47c05ddbd300a99f811d59e044d9. Visual review found that shared default date formatting omitted the reported time; the queue now includes date/hour/minute in explicit UTC, preserving triage information consistently across locale/timezone. A browser assertion requires that visible timezone. These predecessor greens are not final-head acceptance.
