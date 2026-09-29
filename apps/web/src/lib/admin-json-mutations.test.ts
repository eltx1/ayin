import { readFileSync } from "node:fs";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  deleteAdvertiser,
  deleteCampaign,
  deleteCreative,
  getAdvertisers,
} from "./admin-advertising";
import { registerAdminVerification } from "./admin-reauthentication";

const deletes = [
  { run: deleteAdvertiser, path: "advertisers" },
  { run: deleteCampaign, path: "campaigns" },
  { run: deleteCreative, path: "creatives" },
];
afterEach(() => vi.unstubAllGlobals());

describe("Admin JSON mutation transport", () => {
  it.each(deletes)(
    "sends a real JSON body for $path without changing session policy",
    async ({ run, path }) => {
      const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ deleted: true })));
      vi.stubGlobal("fetch", fetcher);
      await expect(run("fixture/id")).resolves.toEqual({ deleted: true });
      expect(fetcher).toHaveBeenCalledExactlyOnceWith(
        expect.stringContaining(`/admin/advertising/${path}/fixture%2Fid`),
        expect.objectContaining({
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: "{}",
          credentials: "include",
          cache: "no-store",
        }),
      );
    },
  );

  it.each(deletes)("does not replay $path after step-up or a lost response", async ({ run }) => {
    const verification = vi.fn();
    const unregister = registerAdminVerification(verification);
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: { code: "STEP_UP_REQUIRED", message: "Verify first" } }),
          { status: 403 },
        ),
      )
      .mockRejectedValueOnce(new TypeError("Response lost"));
    vi.stubGlobal("fetch", fetcher);
    try {
      await expect(run("fixture-id")).rejects.toThrow("Verify first");
      expect(verification).toHaveBeenCalledTimes(1);
      expect(fetcher).toHaveBeenCalledTimes(1);
      await expect(run("fixture-id")).rejects.toThrow("Response lost");
      expect(fetcher).toHaveBeenCalledTimes(2);
    } finally {
      unregister();
    }
  });

  it("does not add bodies to reads", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("[]"));
    vi.stubGlobal("fetch", fetcher);
    await getAdvertisers();
    expect(fetcher.mock.calls[0]![1]).not.toHaveProperty("body");
  });

  // The two legacy panels keep their existing private JSON clients. Validate their
  // real call sites instead of replacing the transport or weakening the API parser.
  it.each([
    ["../components/admin/admin-content-library.tsx", "adminApi", 6],
    ["../components/admin/admin-video-ads.tsx", "request", 4],
  ] as const)("%s never submits a bodyless JSON action", (path, client, count) => {
    const content = readFileSync(new URL(path, import.meta.url), "utf8");
    const source = ts.createSourceFile(
      path,
      content,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    let actions = 0;
    function visit(node: ts.Node) {
      if (ts.isCallExpression(node) && node.expression.getText(source) === client) {
        const init = node.arguments[1];
        if (init && ts.isObjectLiteralExpression(init)) {
          const properties = init.properties.filter(ts.isPropertyAssignment);
          const method = properties.find((p) => p.name.getText(source) === "method");
          if (
            method &&
            ts.isStringLiteral(method.initializer) &&
            ["POST", "PATCH", "DELETE"].includes(method.initializer.text)
          ) {
            actions += 1;
            const body = properties.find((p) => p.name.getText(source) === "body");
            expect(body, node.getText(source)).toBeDefined();
          }
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
    expect(actions).toBe(count);
  });
});
