# Advertising control facts

Prepared source; exact-source PostgreSQL execution is still required.

The native override directory reads 25 real rows with actual total counts in one Repeatable Read transaction. Parameterized SQL searches actual channel names/handles and video titles without materializing unbounded target lists. Literal percent characters are search text. Stable updatedAt/id descending ordering preserves ties. Target facts are fetched only for the selected page inside the same snapshot. Missing targets remain null; missing override records return 404. Safe selections omit updatedBy and createdAt.

The legacy array adapter is capped at 100 minimized records; complete totals and subsequent pages use the directory. Settings record facts distinguish DEFAULT, STORED and INVALID_STORED_DEFAULT, returning the actual stored updatedAt or null. Existing public decisions keep their established settings contract.

Five prepared real PostgreSQL cases cover 25+1 ties, literal search, safe projection, unchanged actual session and audit baselines, legacy 106-row cap, strict filters, Finance denial before service facts, actual cascaded/deleted records, and actual settings fallback provenance. Types, lint, formatting and CI must be recorded after execution rather than inferred.

This is a backend read slice. Captured configuration write versions, native EN/AR advertising recovery, measured rendering, consent/CMP/provider evidence and the complete master Ads scope remain open. No production ad configuration is changed or provider activated by this task.

Actual migrations enforce cascading target foreign keys even though the Prisma scalar-only model omits relations. The deletion test preserves these constraints and verifies cascade removal, empty current directory and direct 404. Defensive null handling does not certify an actual orphan fixture. Initial authority PR225 failure is documented separately; replacement tests are required before acceptance.
