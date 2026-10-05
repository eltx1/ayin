import { randomUUID } from "node:crypto";
import { createPrismaClient } from "../../packages/db/dist/index.js";
import { PasswordService } from "../../apps/api/dist/auth/password.service.js";

// Never fall back to DATABASE_URL: this helper mutates only an explicitly
// selected isolated test database. No API, media-provider, or external writes.
const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("An isolated TEST_DATABASE_URL is required.");
const prisma = createPrismaClient(databaseUrl);
const command = process.argv[2];
const input = JSON.parse(process.argv[3] ?? "{}");
const controlsWhere = { namespace_key: { namespace: "DISCOVERY", key: "productControls" } };
const fixtureWhere = (fixtureId) => ({
  namespace_key: { namespace: "DISCOVERY", key: `hero-lifecycle-${fixtureId}` },
});
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function ownedFixture(tx) {
  if (typeof input.fixtureId !== "string" || !uuid.test(input.fixtureId))
    throw new Error("A verified lifecycle fixture identity is required.");
  const marker = await tx.platformSetting.findUniqueOrThrow({
    where: fixtureWhere(input.fixtureId),
  });
  const owned = marker.value;
  if (owned.fixtureId !== input.fixtureId) throw new Error("Fixture identity mismatch.");
  const account = await tx.account.findUniqueOrThrow({ where: { id: owned.accountId } });
  const profile = await tx.viewerProfile.findUniqueOrThrow({ where: { id: owned.profileId } });
  const channel = await tx.channel.findUniqueOrThrow({ where: { id: owned.channelId } });
  if (
    account.email !== `hero-lifecycle-${input.fixtureId}@example.test` ||
    profile.accountId !== account.id ||
    profile.slug !== `hero-lifecycle-${input.fixtureId}` ||
    channel.handle !== `hero-lifecycle-${input.fixtureId}`
  )
    throw new Error("Refusing to mutate records not owned by this synthetic fixture.");
  const tv = await tx.creatorTvChannel.findUniqueOrThrow({ where: { id: owned.tvId } });
  const owner = await tx.channelMember.findUniqueOrThrow({
    where: { channelId_accountId: { channelId: channel.id, accountId: account.id } },
  });
  if (tv.channelId !== channel.id || channel.primaryTvChannelId !== tv.id || owner.role !== "OWNER")
    throw new Error("Creator identity is outside the owned synthetic fixture.");
  for (const [key, identity] of Object.entries(owned.videos)) {
    const video = await tx.video.findUniqueOrThrow({ where: { id: identity.id } });
    if (video.channelId !== channel.id || video.slug !== `hero-lifecycle-${key}-${input.fixtureId}`)
      throw new Error("Video is outside the owned synthetic fixture.");
  }
  return owned;
}

try {
  if (command === "seed") {
    const fixtureId = randomUUID();
    const password = "Hero-lifecycle-fixture-only-2026!";
    const passwordHash = await new PasswordService().hash(password);
    const result = await prisma.$transaction(async (tx) => {
      const previous = await tx.platformSetting.findUnique({ where: controlsWhere });
      const account = await tx.account.create({
        data: {
          email: `hero-lifecycle-${fixtureId}@example.test`,
          displayName: "Synthetic hero lifecycle viewer",
          passwordHash,
          viewerProfiles: {
            create: {
              name: "Lifecycle default viewer",
              slug: `hero-lifecycle-${fixtureId}`,
              isDefault: true,
            },
          },
        },
        include: { viewerProfiles: true },
      });
      const channel = await tx.channel.create({
        data: {
          handle: `hero-lifecycle-${fixtureId}`,
          name: "Synthetic hero lifecycle creator",
          members: { create: { accountId: account.id, role: "OWNER" } },
        },
      });
      const tv = await tx.creatorTvChannel.create({
        data: {
          channelId: channel.id,
          name: "Lifecycle fixture TV",
          slug: `hero-lifecycle-${fixtureId}`,
        },
      });
      await tx.channel.update({ where: { id: channel.id }, data: { primaryTvChannelId: tv.id } });
      const videos = {};
      for (const key of ["primary", "replacement"]) {
        const video = await tx.video.create({
          data: {
            channelId: channel.id,
            slug: `hero-lifecycle-${key}-${fixtureId}`,
            title:
              key === "primary"
                ? "Original lifecycle feature · حكاية أصلية"
                : "Latest lifecycle feature · حكاية جديدة",
            description: "Authored lifecycle feature description.",
            status: "PUBLISHED",
            visibility: "PUBLIC",
            publishedAt: new Date(),
            durationMs: 120000,
            mediaAssets: {
              create: {
                channelId: channel.id,
                kind: "SOURCE_VIDEO",
                status: "VALIDATED",
                r2ObjectKey: `e2e/hero-lifecycle/${fixtureId}/${key}.mp4`,
                mimeType: "video/mp4",
                sizeBytes: 1024n,
              },
            },
          },
        });
        await tx.videoPolicy.create({
          data: { videoId: video.id, maturityLevel: "TEEN", kidsEligible: false },
        });
        videos[key] = { id: video.id, title: video.title, slug: video.slug };
      }
      const controls = {
        navigation: [
          { key: "home", label: "Home", href: "/", enabled: true, featureFlag: null },
          { key: "search", label: "Search", href: "/search", enabled: true, featureFlag: null },
        ],
        hero: { entityType: "VIDEO", entityId: videos.primary.id },
        taxonomy: [],
        announcement: { enabled: false, text: "", href: null },
        deviceVisibility: { web: true, mobile: true, tv: true },
      };
      await tx.platformSetting.upsert({
        where: controlsWhere,
        create: {
          namespace: "DISCOVERY",
          key: "productControls",
          valueType: "JSON",
          value: controls,
        },
        update: { value: controls },
      });
      const owned = {
        fixtureId,
        accountId: account.id,
        email: account.email,
        profileId: account.viewerProfiles[0].id,
        channelId: channel.id,
        tvId: tv.id,
        videos,
        previousControls: previous ? { value: previous.value } : null,
      };
      await tx.platformSetting.create({
        data: {
          namespace: "DISCOVERY",
          key: `hero-lifecycle-${fixtureId}`,
          valueType: "JSON",
          value: owned,
        },
      });
      return {
        fixtureId,
        accountId: account.id,
        profileId: owned.profileId,
        email: account.email,
        password,
        videos,
      };
    });
    process.stdout.write(JSON.stringify(result));
  } else {
    const result = await prisma.$transaction(async (tx) => {
      const owned = await ownedFixture(tx);
      if (command === "hero") {
        if (!["primary", "replacement"].includes(input.video))
          throw new Error("Unknown owned video.");
        const controls = await tx.platformSetting.findUniqueOrThrow({ where: controlsWhere });
        await tx.platformSetting.update({
          where: controlsWhere,
          data: {
            value: {
              ...controls.value,
              hero: { entityType: "VIDEO", entityId: owned.videos[input.video].id },
            },
          },
        });
      } else if (command === "policy") {
        if (!["primary", "replacement"].includes(input.video))
          throw new Error("Unknown owned video.");
        if (!["public", "private", "revoked", "expired"].includes(input.state))
          throw new Error("Unknown policy state.");
        const videoId = owned.videos[input.video].id;
        await tx.video.update({
          where: { id: videoId },
          data: { visibility: input.state === "private" ? "PRIVATE" : "PUBLIC" },
        });
        await tx.videoPolicy.update({
          where: { videoId },
          data: {
            rightsExpiresAt: input.state === "expired" ? new Date("2000-01-01T00:00:00Z") : null,
          },
        });
        await tx.videoPolicyOverride.deleteMany({ where: { videoId } });
        if (input.state === "revoked")
          await tx.videoPolicyOverride.create({
            data: {
              videoId,
              actorAccountId: owned.accountId,
              disposition: "FORCE_BLOCK",
              reason: "Synthetic lifecycle test revocation",
            },
          });
      } else if (command === "revoke-sessions") {
        const revoked = await tx.accountSession.updateMany({
          where: { accountId: owned.accountId, revokedAt: null },
          data: { revokedAt: new Date(), revokeReason: "SYNTHETIC_LIFECYCLE_TEST" },
        });
        if (revoked.count === 0)
          throw new Error("The owned fixture has no active session to revoke.");
      } else if (command === "default-kids") {
        if (typeof input.isKids !== "boolean") throw new Error("isKids must be a boolean.");
        await tx.viewerProfile.update({
          where: { id: owned.profileId },
          data: { isKids: input.isKids },
        });
      } else if (command === "cleanup") {
        const videoIds = Object.values(owned.videos).map((video) => video.id);
        if (owned.previousControls)
          await tx.platformSetting.update({
            where: controlsWhere,
            data: { value: owned.previousControls.value },
          });
        else
          await tx.platformSetting.deleteMany({
            where: { namespace: "DISCOVERY", key: "productControls" },
          });
        await tx.videoPolicyOverride.deleteMany({ where: { videoId: { in: videoIds } } });
        await tx.videoPolicy.deleteMany({ where: { videoId: { in: videoIds } } });
        await tx.mediaAsset.deleteMany({
          where: { channelId: owned.channelId, videoId: { in: videoIds } },
        });
        await tx.video.deleteMany({ where: { id: { in: videoIds }, channelId: owned.channelId } });
        await tx.channel.delete({ where: { id: owned.channelId } });
        await tx.account.delete({ where: { id: owned.accountId } });
        await tx.platformSetting.delete({ where: fixtureWhere(owned.fixtureId) });
      } else throw new Error("Unknown lifecycle fixture command.");
      return { ok: true };
    });
    process.stdout.write(JSON.stringify(result));
  }
} finally {
  await prisma.$disconnect();
}
