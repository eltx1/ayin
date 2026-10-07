import { randomUUID } from "node:crypto";
import { createPrismaClient } from "../../packages/db/dist/index.js";
import { PasswordService } from "../../apps/api/dist/auth/password.service.js";

// This helper owns only synthetic records in an explicitly selected disposable
// loopback database. It never falls back to DATABASE_URL or changes global controls.
const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("An isolated TEST_DATABASE_URL is required.");
const destination = new URL(databaseUrl);
if (
  !["postgres:", "postgresql:"].includes(destination.protocol) ||
  !["localhost", "127.0.0.1", "[::1]"].includes(destination.hostname) ||
  !/(?:^|_)(?:test|e2e|proof)(?:_|$)/i.test(destination.pathname.slice(1))
)
  throw new Error("The Search fixture requires a named disposable loopback test database.");

const prisma = createPrismaClient(databaseUrl);
const [command, raw = "{}"] = process.argv.slice(2);
const input = JSON.parse(raw);
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const markerWhere = (fixtureId) => ({
  namespace_key: { namespace: "DISCOVERY", key: `search-viewer-${fixtureId}` },
});

async function ownedFixture(tx) {
  if (typeof input.fixtureId !== "string" || !uuid.test(input.fixtureId))
    throw new Error("A verified Search fixture identity is required.");
  const marker = await tx.platformSetting.findUniqueOrThrow({
    where: markerWhere(input.fixtureId),
  });
  const owned = marker.value;
  if (owned.fixtureId !== input.fixtureId) throw new Error("Fixture identity mismatch.");
  const account = await tx.account.findUniqueOrThrow({ where: { id: owned.accountId } });
  const channel = await tx.channel.findUniqueOrThrow({ where: { id: owned.channelId } });
  if (
    account.email !== `search-viewer-${owned.fixtureId}@example.test` ||
    channel.handle !== `search-viewer-${owned.fixtureId}`
  )
    throw new Error("Refusing records outside the synthetic Search fixture.");
  for (const [key, id] of [
    ["primary", owned.profileId],
    ["alternate", owned.alternateProfileId],
  ]) {
    const profile = await tx.viewerProfile.findUniqueOrThrow({ where: { id } });
    if (profile.accountId !== account.id || profile.slug !== `search-${key}-${owned.fixtureId}`)
      throw new Error("Profile is outside the synthetic Search fixture.");
  }
  const membership = await tx.channelMember.findUniqueOrThrow({
    where: { channelId_accountId: { channelId: channel.id, accountId: account.id } },
  });
  const tv = await tx.creatorTvChannel.findUniqueOrThrow({ where: { id: owned.tvId } });
  if (
    membership.role !== "OWNER" ||
    tv.channelId !== channel.id ||
    channel.primaryTvChannelId !== tv.id
  )
    throw new Error("Creator identity is outside the synthetic Search fixture.");
  for (const key of ["adult", "kids"]) {
    const video = await tx.video.findUniqueOrThrow({ where: { id: owned.videos[key].id } });
    if (video.channelId !== channel.id || video.slug !== `search-${key}-${owned.fixtureId}`)
      throw new Error("Video is outside the synthetic Search fixture.");
  }
  return owned;
}

try {
  if (command === "seed") {
    const fixtureId = randomUUID();
    const query = `Searchscope${fixtureId.replaceAll("-", "").slice(0, 12)}`;
    const password = "Search-viewer-fixture-only-2026!";
    const passwordHash = await new PasswordService().hash(password);
    const result = await prisma.$transaction(async (tx) => {
      const account = await tx.account.create({
        data: {
          email: `search-viewer-${fixtureId}@example.test`,
          displayName: "Synthetic Search viewer",
          passwordHash,
          viewerProfiles: {
            create: [
              {
                name: "Search primary viewer",
                slug: `search-primary-${fixtureId}`,
                isDefault: true,
              },
              { name: "Search alternate viewer", slug: `search-alternate-${fixtureId}` },
            ],
          },
        },
        include: { viewerProfiles: true },
      });
      const channel = await tx.channel.create({
        data: {
          handle: `search-viewer-${fixtureId}`,
          name: `${query} creator`,
          members: { create: { accountId: account.id, role: "OWNER" } },
        },
      });
      const tv = await tx.creatorTvChannel.create({
        data: {
          channelId: channel.id,
          name: "Synthetic Search TV",
          slug: `search-viewer-${fixtureId}`,
        },
      });
      await tx.channel.update({ where: { id: channel.id }, data: { primaryTvChannelId: tv.id } });
      const videos = {};
      for (const key of ["adult", "kids"]) {
        const video = await tx.video.create({
          data: {
            channelId: channel.id,
            slug: `search-${key}-${fixtureId}`,
            title: `${query} ${key === "adult" ? "Adult story · حكاية للكبار" : "Kids story · حكاية للأطفال"}`,
            description: "Synthetic Search lifecycle verification fixture.",
            status: "PUBLISHED",
            visibility: "PUBLIC",
            publishedAt: new Date(),
            durationMs: 120_000,
            mediaAssets: {
              create: {
                channelId: channel.id,
                kind: "SOURCE_VIDEO",
                status: "VALIDATED",
                r2ObjectKey: `e2e/search-viewer/${fixtureId}/${key}.mp4`,
                mimeType: "video/mp4",
                sizeBytes: 1024n,
              },
            },
          },
        });
        await tx.videoPolicy.create({
          data: {
            videoId: video.id,
            maturityLevel: key === "kids" ? "GENERAL" : "MATURE",
            kidsEligible: key === "kids",
            ageRestriction: key === "kids" ? "NONE" : "AGE_18_PLUS",
          },
        });
        videos[key] = { id: video.id, title: video.title, slug: video.slug };
      }
      const owned = {
        fixtureId,
        accountId: account.id,
        profileId: account.viewerProfiles.find((profile) => profile.isDefault).id,
        alternateProfileId: account.viewerProfiles.find((profile) => !profile.isDefault).id,
        email: account.email,
        channelId: channel.id,
        tvId: tv.id,
        query,
        videos,
      };
      await tx.platformSetting.create({
        data: {
          namespace: "DISCOVERY",
          key: `search-viewer-${fixtureId}`,
          valueType: "JSON",
          value: owned,
        },
      });
      return { ...owned, password };
    });
    process.stdout.write(JSON.stringify(result));
  } else {
    const result = await prisma.$transaction(async (tx) => {
      const owned = await ownedFixture(tx);
      if (command === "default-kids") {
        if (typeof input.isKids !== "boolean") throw new Error("isKids must be a boolean.");
        const current = await tx.viewerProfile.findFirstOrThrow({
          where: { accountId: owned.accountId, isDefault: true, deletedAt: null },
          orderBy: { createdAt: "asc" },
        });
        if (![owned.profileId, owned.alternateProfileId].includes(current.id))
          throw new Error("Default profile is outside the owned fixture.");
        await tx.viewerProfile.update({
          where: { id: current.id },
          data: { isKids: input.isKids },
        });
      } else if (command === "switch-default") {
        if (typeof input.alternate !== "boolean") throw new Error("alternate must be a boolean.");
        await tx.viewerProfile.updateMany({
          where: {
            id: { in: [owned.profileId, owned.alternateProfileId] },
            accountId: owned.accountId,
          },
          data: { isDefault: false },
        });
        await tx.viewerProfile.update({
          where: { id: input.alternate ? owned.alternateProfileId : owned.profileId },
          data: { isDefault: true },
        });
      } else if (command === "swap-video-slugs") {
        // Replace the video reached by a stable deep link using only this
        // fixture's verified synthetic rows; preserve cleanup ownership.
        await tx.video.update({
          where: { id: owned.videos.adult.id },
          data: { slug: `search-swap-${owned.fixtureId}` },
        });
        await tx.video.update({
          where: { id: owned.videos.kids.id },
          data: { slug: owned.videos.adult.slug },
        });
        await tx.video.update({
          where: { id: owned.videos.adult.id },
          data: { slug: owned.videos.kids.slug },
        });
        const videos = {
          adult: { ...owned.videos.kids, slug: owned.videos.adult.slug },
          kids: { ...owned.videos.adult, slug: owned.videos.kids.slug },
        };
        await tx.platformSetting.update({
          where: markerWhere(owned.fixtureId),
          data: { value: { ...owned, videos } },
        });
        return { ...owned, videos };
      } else if (command === "cleanup") {
        const videoIds = Object.values(owned.videos).map((video) => video.id);
        await tx.videoPolicy.deleteMany({ where: { videoId: { in: videoIds } } });
        await tx.video.deleteMany({ where: { id: { in: videoIds }, channelId: owned.channelId } });
        await tx.channel.delete({ where: { id: owned.channelId } });
        await tx.account.delete({ where: { id: owned.accountId } });
        await tx.platformSetting.delete({ where: markerWhere(owned.fixtureId) });
      } else throw new Error("Unknown Search fixture command.");
      return { ok: true };
    });
    process.stdout.write(JSON.stringify(result));
  }
} finally {
  await prisma.$disconnect();
}
