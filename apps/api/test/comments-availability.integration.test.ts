import { randomUUID } from "node:crypto";
import { createPrismaClient } from "@ayin/db";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AppModule } from "../src/app.module.js";
import { AuthTokenService } from "../src/auth/auth-token.service.js";
const databaseUrl = process.env.TEST_DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;
databaseDescribe("Comments public availability and Kids server boundary", () => {
  const prisma = createPrismaClient(databaseUrl);
  let app: NestFastifyApplication;
  const previousToken = process.env.AYIN_INTERNAL_EDGE_TOKEN;
  beforeAll(async () => {
    process.env.APP_ENV = "test";
    process.env.DATABASE_URL = databaseUrl;
    process.env.AUTH_TOKEN_SECRET =
      "comments-availability-auth-secret-with-more-than-32-characters";
    process.env.UPLOAD_SESSION_SECRET =
      "comments-availability-upload-secret-with-more-than-32-characters";
    process.env.WEB_ORIGIN = "http://localhost:3000";
    process.env.AYIN_INTERNAL_EDGE_TOKEN = "comments-test-edge-token";
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });
  beforeEach(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "Account", "Channel" CASCADE');
  });
  afterAll(async () => {
    if (previousToken === undefined) delete process.env.AYIN_INTERNAL_EDGE_TOKEN;
    else process.env.AYIN_INTERNAL_EDGE_TOKEN = previousToken;
    await app.close();
    await prisma.$disconnect();
  });
  async function fixture() {
    const response = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        name: "Comments policy viewer",
        email: "comment-policy@example.test",
        password: "strong-pass-123",
      },
    });
    expect(response.statusCode).toBe(201);
    const user = response.json().user;
    const raw = response.headers["set-cookie"];
    const cookie = (Array.isArray(raw) ? raw[0] : raw)?.split(";", 1)[0] ?? "";
    const video = await prisma.video.create({
      data: {
        channelId: user.channel.id,
        title: "Policy video",
        slug: `policy-${randomUUID()}`,
        status: "PUBLISHED",
        visibility: "PUBLIC",
        commentsEnabled: true,
        publishedAt: new Date(),
      },
    });
    const comment = await prisma.comment.create({
      data: { videoId: video.id, authorProfileId: user.profile.id, body: "Policy comment" },
    });
    return { user, video, comment, cookie };
  }
  it("uses trusted region for comment reads/writes and denies expired rights and removed channels", async () => {
    const f = await fixture();
    await prisma.videoPolicy.create({ data: { videoId: f.video.id, allowedTerritories: ["EG"] } });
    const url = `/comments/videos/${f.video.id}`;
    expect(
      (await app.inject({ method: "GET", url, headers: { "x-ayin-edge-country": "EG" } }))
        .statusCode,
    ).toBe(404);
    const headers = {
      cookie: f.cookie,
      "x-ayin-edge-country": "EG",
      "x-ayin-edge-token": "comments-test-edge-token",
    };
    const read = await app.inject({ method: "GET", url, headers });
    expect(read.statusCode).toBe(200);
    expect(read.json().items).toHaveLength(1);
    expect(
      (await app.inject({ method: "POST", url, headers, payload: { body: "Allowed comment" } }))
        .statusCode,
    ).toBe(201);
    await prisma.videoPolicy.update({
      where: { videoId: f.video.id },
      data: { rightsExpiresAt: new Date(Date.now() - 1000) },
    });
    for (const request of [
      { method: "GET" as const, url },
      { method: "POST" as const, url, payload: { body: "Denied comment" } },
      { method: "PUT" as const, url: `/comments/${f.comment.id}/like`, payload: {} },
      {
        method: "POST" as const,
        url: `/comments/${f.comment.id}/report`,
        payload: { reason: "SPAM" },
      },
    ])
      expect((await app.inject({ ...request, headers })).statusCode).toBe(404);
    expect(await prisma.comment.count({ where: { videoId: f.video.id } })).toBe(2);
    expect(await prisma.reaction.count({ where: { commentId: f.comment.id } })).toBe(0);
    expect(await prisma.report.count({ where: { commentId: f.comment.id } })).toBe(0);
    await prisma.videoPolicy.update({
      where: { videoId: f.video.id },
      data: { rightsExpiresAt: null },
    });
    await prisma.channel.update({
      where: { id: f.video.channelId },
      data: { removedAt: new Date() },
    });
    expect((await app.inject({ method: "GET", url, headers })).statusCode).toBe(404);
  });
  it("blocks Kids profile comment/reaction/report writes without weakening owner cleanup", async () => {
    const f = await fixture();
    await prisma.viewerProfile.update({ where: { id: f.user.profile.id }, data: { isKids: true } });
    const headers = { cookie: f.cookie };
    for (const request of [
      {
        method: "POST" as const,
        url: `/comments/videos/${f.video.id}`,
        payload: { body: "Kids write", profileId: f.user.profile.id },
      },
      {
        method: "PUT" as const,
        url: `/comments/${f.comment.id}/like`,
        payload: { profileId: f.user.profile.id },
      },
      {
        method: "POST" as const,
        url: `/comments/${f.comment.id}/report`,
        payload: { reason: "SPAM", profileId: f.user.profile.id },
      },
    ])
      expect((await app.inject({ ...request, headers })).statusCode).toBe(403);
    expect(await prisma.comment.count({ where: { videoId: f.video.id } })).toBe(1);
    expect(await prisma.reaction.count({ where: { commentId: f.comment.id } })).toBe(0);
    expect(await prisma.report.count({ where: { commentId: f.comment.id } })).toBe(0);
    expect(
      (await app.inject({ method: "DELETE", url: `/comments/${f.comment.id}`, headers }))
        .statusCode,
    ).toBe(200);
  });
  it("rejects unrelated staff and unverified administrators across creator moderation paths", async () => {
    const f = await fixture();
    const channel = await prisma.channel.create({
      data: { handle: `foreign-${randomUUID()}`, name: "Foreign creator", status: "ACTIVE" },
    });
    const video = await prisma.video.create({
      data: {
        channelId: channel.id,
        title: "Foreign video",
        slug: `foreign-${randomUUID()}`,
        status: "PUBLISHED",
        visibility: "PUBLIC",
        commentsEnabled: true,
      },
    });
    const comment = await prisma.comment.create({
      data: {
        videoId: video.id,
        authorProfileId: f.user.profile.id,
        body: "Owned comment on a foreign channel",
      },
    });
    const assignment = await prisma.adminRoleAssignment.create({
      data: { accountId: f.user.account.id, role: "AD_MANAGER" },
    });
    // Registration verifies the password and creates a fresh reauth assurance.
    // Sign a real persisted session without that assurance to test the deny boundary.
    const tokens = app.get(AuthTokenService);
    const payload = tokens.verifySession(
      decodeURIComponent(f.cookie.split("=").slice(1).join("=")),
    )!;
    const unassured = tokens.issueSession(
      payload.sub,
      payload.av,
      payload.sid!,
      new Date(payload.exp * 1000),
    );
    const headers = { cookie: `ayin_session=${encodeURIComponent(unassured)}` };
    const requests = [
      {
        method: "PATCH" as const,
        url: `/comments/videos/${video.id}/settings`,
        payload: { enabled: false },
      },
      {
        method: "PATCH" as const,
        url: `/comments/${comment.id}/moderation`,
        payload: { status: "HIDDEN" },
      },
      { method: "PUT" as const, url: `/comments/${comment.id}/heart` },
      {
        method: "PUT" as const,
        url: `/comments/channels/${channel.id}/hidden-profiles/${f.user.profile.id}`,
      },
    ];
    for (const request of requests)
      expect((await app.inject({ ...request, headers })).statusCode).toBe(403);
    await prisma.adminRoleAssignment.update({
      where: { id: assignment.id },
      data: { role: "CONTENT_MODERATOR" },
    });
    for (const request of requests) {
      const response = await app.inject({ ...request, headers });
      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe("STEP_UP_REQUIRED");
    }
    await prisma.adminRoleAssignment.update({
      where: { id: assignment.id },
      data: { role: "ADMIN" },
    });
    for (const request of requests) {
      const response = await app.inject({ ...request, headers });
      expect(response.statusCode).toBe(401);
      expect(response.json().error.message).toBe("Administrator MFA verification is required.");
    }
    expect(
      (await prisma.video.findUniqueOrThrow({ where: { id: video.id } })).commentsEnabled,
    ).toBe(true);
    expect((await prisma.comment.findUniqueOrThrow({ where: { id: comment.id } })).status).toBe(
      "PUBLISHED",
    );
    expect(await prisma.commentControl.count({ where: { commentId: comment.id } })).toBe(0);
    expect(await prisma.channelHiddenProfile.count({ where: { channelId: channel.id } })).toBe(0);
    // Own-channel operations still use creator membership rather than global staff privilege.
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/comments/videos/${f.video.id}/settings`,
          headers,
          payload: { enabled: false },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ method: "DELETE", url: `/comments/${comment.id}`, headers })).statusCode,
    ).toBe(200);
  });
  async function failProfileAudit(
    action: "COMMENT_PROFILE_HIDE" | "COMMENT_PROFILE_UNHIDE",
    run: () => Promise<void>,
  ) {
    // Test-only database fault exercises rollback after the real companion writes.
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION ayin_test_profile_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."action" = '${action}' THEN RAISE EXCEPTION 'test profile audit failure'; END IF; RETURN NEW; END; $$`,
    );
    try {
      await prisma.$executeRawUnsafe(
        'CREATE TRIGGER ayin_test_profile_audit_failure BEFORE INSERT ON "AdminAuditLog" FOR EACH ROW EXECUTE FUNCTION ayin_test_profile_audit_failure()',
      );
      await run();
    } finally {
      await prisma.$executeRawUnsafe(
        'DROP TRIGGER IF EXISTS ayin_test_profile_audit_failure ON "AdminAuditLog"',
      );
      await prisma.$executeRawUnsafe("DROP FUNCTION IF EXISTS ayin_test_profile_audit_failure()");
    }
  }
  async function waitForProfileLock() {
    await vi.waitFor(
      async () => {
        const rows = await prisma.$queryRaw<
          Array<{ waiting: bigint }>
        >`SELECT count(*)::bigint AS waiting FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%ViewerProfile%FOR UPDATE%'`;
        expect(Number(rows[0]?.waiting ?? 0)).toBeGreaterThan(0);
      },
      { timeout: 3000, interval: 25 },
    );
  }
  it("waits for a concurrent suppression commit before authorizing comment creation", async () => {
    const f = await fixture();
    let release!: () => void, locked!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const holder = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "ViewerProfile" WHERE "id" = ${f.user.profile.id}::uuid FOR UPDATE`;
        await tx.channelHiddenProfile.create({
          data: {
            channelId: f.video.channelId,
            profileId: f.user.profile.id,
            hiddenByAccountId: f.user.account.id,
          },
        });
        locked();
        await gate;
      },
      { timeout: 10000 },
    );
    let pending: ReturnType<typeof app.inject> | undefined;
    try {
      await ready;
      pending = app.inject({
        method: "POST",
        url: `/comments/videos/${f.video.id}`,
        headers: { cookie: f.cookie, origin: "http://localhost:3000" },
        payload: { body: "Concurrent denied comment" },
      });
      // inject is thenable; start execution without waiting for the locked request.
      const response = pending.then((value) => value);
      await waitForProfileLock();
      release();
      await holder;
      expect((await response).statusCode).toBe(403);
      expect(await prisma.comment.count({ where: { videoId: f.video.id } })).toBe(1);
    } finally {
      release();
      await holder;
      if (pending) await pending;
    }
  });
  it("waits for a concurrent comment commit and includes that comment in suppression", async () => {
    const f = await fixture();
    let release!: () => void, locked!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const holder = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "ViewerProfile" WHERE "id" = ${f.user.profile.id}::uuid FOR UPDATE`;
        const comment = await tx.comment.create({
          data: {
            videoId: f.video.id,
            authorProfileId: f.user.profile.id,
            body: "Concurrent committed comment",
          },
        });
        locked();
        await gate;
        return comment.id;
      },
      { timeout: 10000 },
    );
    let pending: ReturnType<typeof app.inject> | undefined;
    try {
      await ready;
      pending = app.inject({
        method: "PUT",
        url: `/comments/channels/${f.video.channelId}/hidden-profiles/${f.user.profile.id}`,
        headers: { cookie: f.cookie, origin: "http://localhost:3000" },
      });
      const response = pending.then((value) => value);
      await waitForProfileLock();
      release();
      const commentId = await holder;
      expect((await response).statusCode).toBe(200);
      expect((await prisma.comment.findUniqueOrThrow({ where: { id: commentId } })).status).toBe(
        "HIDDEN",
      );
      expect(
        await prisma.comment.count({ where: { videoId: f.video.id, status: "PUBLISHED" } }),
      ).toBe(0);
    } finally {
      release();
      await holder;
      if (pending) await pending;
    }
  });
  it("commits profile suppression, existing comment hiding and audit together; unhide never republishes old comments", async () => {
    const f = await fixture();
    const url = `/comments/channels/${f.video.channelId}/hidden-profiles/${f.user.profile.id}`;
    const headers = { cookie: f.cookie, origin: "http://localhost:3000" };
    expect((await app.inject({ method: "PUT", url, headers })).statusCode).toBe(200);
    expect(
      await prisma.channelHiddenProfile.count({
        where: { channelId: f.video.channelId, profileId: f.user.profile.id },
      }),
    ).toBe(1);
    expect((await prisma.comment.findUniqueOrThrow({ where: { id: f.comment.id } })).status).toBe(
      "HIDDEN",
    );
    const audit = await prisma.adminAuditLog.findFirstOrThrow({
      where: {
        actorAccountId: f.user.account.id,
        action: "COMMENT_PROFILE_HIDE",
        entityId: f.user.profile.id,
      },
    });
    expect(audit.metadata).toMatchObject({ channelId: f.video.channelId, hidden: true });
    expect((await app.inject({ method: "DELETE", url, headers })).statusCode).toBe(200);
    expect(
      await prisma.channelHiddenProfile.count({
        where: { channelId: f.video.channelId, profileId: f.user.profile.id },
      }),
    ).toBe(0);
    expect((await prisma.comment.findUniqueOrThrow({ where: { id: f.comment.id } })).status).toBe(
      "HIDDEN",
    );
    expect(
      await prisma.adminAuditLog.count({
        where: { actorAccountId: f.user.account.id, action: "COMMENT_PROFILE_UNHIDE" },
      }),
    ).toBe(1);
  });
  it("rolls profile and comment changes back when the final hide audit write fails", async () => {
    const f = await fixture();
    await failProfileAudit("COMMENT_PROFILE_HIDE", async () => {
      const response = await app.inject({
        method: "PUT",
        url: `/comments/channels/${f.video.channelId}/hidden-profiles/${f.user.profile.id}`,
        headers: { cookie: f.cookie, origin: "http://localhost:3000" },
      });
      expect(response.statusCode).toBe(500);
      expect(
        await prisma.channelHiddenProfile.count({
          where: { channelId: f.video.channelId, profileId: f.user.profile.id },
        }),
      ).toBe(0);
      expect((await prisma.comment.findUniqueOrThrow({ where: { id: f.comment.id } })).status).toBe(
        "PUBLISHED",
      );
      expect(
        await prisma.adminAuditLog.count({
          where: { actorAccountId: f.user.account.id, action: "COMMENT_PROFILE_HIDE" },
        }),
      ).toBe(0);
    });
  });
  it("retains profile suppression when the final unhide audit write fails", async () => {
    const f = await fixture();
    await prisma.channelHiddenProfile.create({
      data: {
        channelId: f.video.channelId,
        profileId: f.user.profile.id,
        hiddenByAccountId: f.user.account.id,
      },
    });
    await prisma.comment.update({ where: { id: f.comment.id }, data: { status: "HIDDEN" } });
    await failProfileAudit("COMMENT_PROFILE_UNHIDE", async () => {
      const response = await app.inject({
        method: "DELETE",
        url: `/comments/channels/${f.video.channelId}/hidden-profiles/${f.user.profile.id}`,
        headers: { cookie: f.cookie, origin: "http://localhost:3000" },
      });
      expect(response.statusCode).toBe(500);
      expect(
        await prisma.channelHiddenProfile.count({
          where: { channelId: f.video.channelId, profileId: f.user.profile.id },
        }),
      ).toBe(1);
      expect((await prisma.comment.findUniqueOrThrow({ where: { id: f.comment.id } })).status).toBe(
        "HIDDEN",
      );
      expect(
        await prisma.adminAuditLog.count({
          where: { actorAccountId: f.user.account.id, action: "COMMENT_PROFILE_UNHIDE" },
        }),
      ).toBe(0);
    });
  });
});
