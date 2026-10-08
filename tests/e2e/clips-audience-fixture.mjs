import { randomUUID } from "node:crypto";
import { createPrismaClient } from "../../packages/db/dist/index.js";
import { PasswordService } from "../../apps/api/dist/auth/password.service.js";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("An isolated TEST_DATABASE_URL is required.");
const target = new URL(url);
if (
  !["postgres:", "postgresql:"].includes(target.protocol) ||
  !["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) ||
  !/(?:^|_)(?:test|e2e|proof)(?:_|$)/i.test(target.pathname.slice(1))
)
  throw new Error("Clips fixtures require a disposable loopback test database.");
const prisma = createPrismaClient(url);
const [command, raw = "{}"] = process.argv.slice(2);
const input = JSON.parse(raw);
const marker = (fixtureId) => ({
  namespace_key: { namespace: "DISCOVERY", key: `clips-audience-${fixtureId}` },
});
try {
  if (command === "seed") {
    const count = input.count ?? 25;
    if (!Number.isInteger(count) || count < 2 || count > 130)
      throw new Error("Fixture count must be between 2 and 130.");
    const fixtureId = randomUUID();
    const password = "Clips-audience-fixture-only-2026!";
    const passwordHash = await new PasswordService().hash(password);
    const result = await prisma.$transaction(async (tx) => {
      const account = await tx.account.create({
        data: {
          email: `clips-audience-${fixtureId}@example.test`,
          displayName: "Synthetic Clips viewer",
          passwordHash,
          viewerProfiles: {
            create: [
              { name: "Clips viewer", slug: `clips-primary-${fixtureId}`, isDefault: true },
              { name: "Alternate Clips viewer", slug: `clips-alternate-${fixtureId}` },
            ],
          },
        },
        include: { viewerProfiles: true },
      });
      const channel = await tx.channel.create({
        data: {
          handle: `clips-audience-${fixtureId}`,
          name: "Clips audience creator",
          members: { create: { accountId: account.id, role: "OWNER" } },
        },
      });
      const tv = await tx.creatorTvChannel.create({
        data: {
          channelId: channel.id,
          name: "Clips audience TV",
          slug: `clips-audience-${fixtureId}`,
        },
      });
      await tx.channel.update({ where: { id: channel.id }, data: { primaryTvChannelId: tv.id } });
      const videos = [];
      const now = Date.now();
      for (let index = 0; index < count; index++) {
        const isKids = index !== 0;
        const video = await tx.video.create({
          data: {
            channelId: channel.id,
            slug: `clips-audience-${fixtureId}-${index}`,
            title:
              index === 0 && input.longText
                ? "مقطع AYIN Arabic title ".repeat(12).slice(0, 200)
                : `Clips ${fixtureId} ${isKids ? `Kids ${index}` : "Adult"}`,
            description:
              index === 0 && input.longText
                ? "وصف التصوير كامل باللغة العربية. English recording notes. "
                    .repeat(500)
                    .slice(0, 19_970) + "END OF COMPLETE DESCRIPTION."
                : "Synthetic local Clips acceptance fixture.",
            videoForm: "CLIP",
            status: "PUBLISHED",
            visibility: "PUBLIC",
            durationMs: 30_000,
            publishedAt: new Date(now - index),
            mediaAssets: {
              create: {
                channelId: channel.id,
                kind: "SOURCE_VIDEO",
                status: "VALIDATED",
                r2ObjectKey: `e2e/clips-audience/${fixtureId}/${index}/canonical.mp4`,
                mimeType: "video/mp4",
                sizeBytes: 1024n,
              },
            },
          },
        });
        await tx.videoPolicy.create({
          data: {
            videoId: video.id,
            kidsEligible: isKids,
            maturityLevel: isKids ? "GENERAL" : "MATURE",
            ageRestriction: isKids ? "NONE" : "AGE_18_PLUS",
          },
        });
        videos.push({ id: video.id, title: video.title, slug: video.slug });
      }
      const owned = {
        fixtureId,
        accountId: account.id,
        profileId: account.viewerProfiles.find((profile) => profile.isDefault).id,
        alternateProfileId: account.viewerProfiles.find((profile) => !profile.isDefault).id,
        channelId: channel.id,
        email: account.email,
        videos,
      };
      await tx.platformSetting.create({
        data: {
          namespace: "DISCOVERY",
          key: `clips-audience-${fixtureId}`,
          valueType: "JSON",
          value: owned,
        },
      });
      return { ...owned, password };
    });
    process.stdout.write(JSON.stringify(result));
  } else {
    const result = await prisma.$transaction(async (tx) => {
      if (typeof input.fixtureId !== "string" || !/^[0-9a-f-]{36}$/i.test(input.fixtureId))
        throw new Error("Fixture ID required.");
      const saved = await tx.platformSetting.findUniqueOrThrow({ where: marker(input.fixtureId) });
      const owned = saved.value;
      const account = await tx.account.findUniqueOrThrow({ where: { id: owned.accountId } });
      const channel = await tx.channel.findUniqueOrThrow({ where: { id: owned.channelId } });
      if (
        owned.fixtureId !== input.fixtureId ||
        account.email !== `clips-audience-${input.fixtureId}@example.test` ||
        channel.handle !== `clips-audience-${input.fixtureId}`
      )
        throw new Error("Fixture ownership mismatch.");
      for (const id of [owned.profileId, owned.alternateProfileId]) {
        const profile = await tx.viewerProfile.findUniqueOrThrow({ where: { id } });
        if (profile.accountId !== account.id) throw new Error("Profile ownership mismatch.");
      }
      const ids = owned.videos.map((video) => video.id);
      if (
        (await tx.video.count({ where: { id: { in: ids }, channelId: channel.id } })) !== ids.length
      )
        throw new Error("Video ownership mismatch.");
      if (command === "default-kids") {
        if (typeof input.isKids !== "boolean") throw new Error("Expected a boolean.");
        await tx.viewerProfile.update({
          where: { id: owned.profileId },
          data: { isKids: input.isKids },
        });
      } else if (command === "switch-default") {
        await tx.viewerProfile.updateMany({
          where: { id: { in: [owned.profileId, owned.alternateProfileId] } },
          data: { isDefault: false },
        });
        await tx.viewerProfile.update({
          where: { id: owned.alternateProfileId },
          data: { isDefault: true, isKids: true },
        });
      } else if (command === "cleanup") {
        await tx.videoPolicy.deleteMany({ where: { videoId: { in: ids } } });
        await tx.video.deleteMany({ where: { id: { in: ids }, channelId: channel.id } });
        await tx.channel.delete({ where: { id: channel.id } });
        await tx.account.delete({ where: { id: account.id } });
        await tx.platformSetting.delete({ where: marker(input.fixtureId) });
      } else throw new Error("Unknown Clips fixture command.");
      return { ok: true };
    });
    process.stdout.write(JSON.stringify(result));
  }
} finally {
  await prisma.$disconnect();
}
