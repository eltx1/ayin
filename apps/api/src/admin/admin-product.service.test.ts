import { Prisma } from "@ayin/db";
import { describe, expect, it, vi } from "vitest";
import { createHomeRowSchema } from "./admin-product-config.js";
import { AdminProductService, homeRowsRevision } from "./admin-product.service.js";

const actor = "11111111-1111-4111-8111-111111111111";
const requestId = "22222222-2222-4222-8222-222222222222";
const updatedAt = new Date("2026-10-22T18:00:00.000Z");
const input = () =>
  createHomeRowSchema.parse({
    requestId,
    expectedRowsRevision: homeRowsRevision([]),
    key: "documentaries",
    title: "وثائقيات",
    source: "RECENTLY_ADDED",
    reason: "Create a documentary section",
    targetRegions: ["FR", "gb", "FR"],
  });

function stored(id = requestId, key = "documentaries") {
  return {
    id,
    key,
    title: "وثائقيات",
    source: "RECENTLY_ADDED",
    audience: "ALL",
    enabled: true,
    maxItems: 24,
    position: 0,
    regionPersonalizationRequired: false,
    createdAt: updatedAt,
    updatedAt,
    regionTargets: [{ regionCode: "FR" }, { regionCode: "GB" }],
    manualItems: [],
  };
}

function setup(initial: ReturnType<typeof stored>[] = [], mode = "AUTO") {
  const rows = [...initial];
  const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
    const row = {
      ...stored(data.id as string, data.key as string),
      ...data,
      regionTargets:
        (data.regionTargets as { create: Array<{ regionCode: string }> } | undefined)?.create ?? [],
    } as ReturnType<typeof stored>;
    rows.push(row);
    return row;
  });
  const tx = { homeRowConfig: { findMany: vi.fn(async () => [...rows]), create } };
  const transaction = vi.fn(async (callback: (value: typeof tx) => unknown) => callback(tx));
  const database = { client: { $transaction: transaction } };
  const audit = { recordInTransaction: vi.fn().mockResolvedValue(undefined) };
  const settings = { getResolvedInTransaction: vi.fn().mockResolvedValue({ value: mode }) };
  const service = new AdminProductService(database as never, audit as never, settings as never);
  return { service, rows, create, transaction, tx, audit, settings };
}

describe("Admin section creation", () => {
  it("creates and audits one bounded section, then safely acknowledges an exact retry", async () => {
    const { service, rows, create, transaction, audit, tx } = setup();
    const first = await service.createRow(actor, input());
    expect(first).toMatchObject({
      replayed: false,
      row: { id: requestId, position: 0, targetRegions: ["FR", "GB"] },
      homeRowsRevision: homeRowsRevision(rows),
    });
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
    expect(audit.recordInTransaction).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        actorAccountId: actor,
        entityId: requestId,
        action: "HOME_ROW_CREATED",
        reason: input().reason,
      }),
    );
    // A lost first response leaves the caller with its old revision. The same
    // request still acknowledges the saved row instead of inserting or auditing twice.
    expect(await service.createRow(actor, input())).toMatchObject({ replayed: true });
    expect(create).toHaveBeenCalledOnce();
    expect(audit.recordInTransaction).toHaveBeenCalledOnce();
  });

  it("rejects request reuse with changed fields and a different request using the same key", async () => {
    const { service, create, audit } = setup([stored()]);
    await expect(service.createRow(actor, { ...input(), enabled: false })).rejects.toMatchObject({
      status: 409,
      response: { error: { code: "HOME_ROW_REQUEST_CONFLICT" } },
    });
    await expect(service.createRow(actor, { ...input(), requestId: actor })).rejects.toMatchObject({
      status: 409,
      response: { error: { code: "HOME_ROW_KEY_EXISTS" } },
    });
    expect(create).not.toHaveBeenCalled();
    expect(audit.recordInTransaction).not.toHaveBeenCalled();
  });

  it("rejects a stale snapshot and never overwrites an existing disabled section", async () => {
    const disabled = { ...stored(actor, "kept-disabled"), enabled: false };
    const { service, create, rows } = setup([disabled]);
    await expect(service.createRow(actor, input())).rejects.toMatchObject({
      status: 409,
      response: { error: { code: "HOME_ROWS_CHANGED" } },
    });
    expect(create).not.toHaveBeenCalled();
    expect(rows).toEqual([disabled]);
  });

  it("requires explicit first-section review for INHERIT, even when the new section is disabled", async () => {
    const { service, create, audit } = setup([], "INHERIT");
    const draft = { ...input(), enabled: false };
    await expect(service.createRow(actor, draft)).rejects.toMatchObject({
      status: 409,
      response: { error: { code: "HOME_MODE_REVIEW_REQUIRED" } },
    });
    expect(create).not.toHaveBeenCalled();
    await service.createRow(actor, { ...draft, confirmManagedTransition: true });
    expect(audit.recordInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        metadata: expect.objectContaining({ inheritedModeChanged: true }),
      }),
    );
    expect(create.mock.calls[0]![0].data.enabled).toBe(false);
  });

  it.each(["AUTO", "MANAGED"])("keeps explicit %s mode while creating a section", async (mode) => {
    const { service, audit } = setup([], mode);
    await expect(service.createRow(actor, input())).resolves.toMatchObject({ replayed: false });
    expect(audit.recordInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        metadata: expect.objectContaining({ inheritedModeChanged: false }),
      }),
    );
  });

  it("enforces the section limit before a write", async () => {
    const rows = Array.from({ length: 100 }, (_, index) =>
      stored(`33333333-3333-4333-8333-${String(index).padStart(12, "0")}`, `section-${index}`),
    );
    const { service, create } = setup(rows);
    await expect(
      service.createRow(actor, { ...input(), expectedRowsRevision: homeRowsRevision(rows) }),
    ).rejects.toMatchObject({
      status: 409,
      response: { error: { code: "HOME_ROW_LIMIT_REACHED" } },
    });
    expect(create).not.toHaveBeenCalled();
  });

  it.each(["P2002", "P2034"])(
    "reports concurrent %s as a reviewable conflict without replay",
    async (code) => {
      const { service, transaction } = setup();
      transaction.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError("Concurrent section change", {
          code,
          clientVersion: "test",
        }),
      );
      await expect(service.createRow(actor, input())).rejects.toMatchObject({ status: 409 });
      expect(transaction).toHaveBeenCalledOnce();
    },
  );

  it("binds the revision to row updates without depending on read ordering", () => {
    const rows = [stored(), stored(actor, "second")];
    expect(homeRowsRevision(rows)).toBe(homeRowsRevision([...rows].reverse()));
    expect(
      homeRowsRevision([{ ...rows[0]!, updatedAt: new Date(updatedAt.getTime() + 1) }, rows[1]!]),
    ).not.toBe(homeRowsRevision(rows));
  });
});
