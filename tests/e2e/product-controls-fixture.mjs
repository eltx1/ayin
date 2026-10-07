import { createPrismaClient } from "../../packages/db/dist/index.js";
import { defaultProductControls } from "../../apps/api/dist/admin/admin-product-config.js";

const prisma = createPrismaClient(process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL);
const [command, raw = "{}"] = process.argv.slice(2);
const input = JSON.parse(raw);
const where = { namespace: "DISCOVERY", key: "productControls" };
try {
  let result;
  if (command === "reset") {
    await prisma.platformSetting.deleteMany({ where });
    await prisma.homeRowConfig.deleteMany({
      where: { key: { startsWith: "e2e-product-controls-" } },
    });
    result = { ok: true };
  } else if (command === "seed") {
    const controls = {
      ...defaultProductControls,
      taxonomy: [
        { key: "stories-original", label: "قصص، ثقافة", enabled: false },
        { key: "film-original", label: "Film, documentary", enabled: true },
      ],
      deviceVisibility: { web: true, mobile: false, tv: true },
    };
    await prisma.platformSetting.create({ data: { ...where, value: controls, valueType: "JSON" } });
    const row = await prisma.homeRowConfig.create({
      data: {
        key: "e2e-product-controls-region",
        title: "Product stories · قصص المنتج",
        source: "RECENTLY_ADDED",
        audience: "ALL",
        position: 900,
        maxItems: 8,
        enabled: false,
      },
    });
    result = { controls, row };
  } else if (command === "evidence") {
    result = {
      controls: (
        await prisma.platformSetting.findUniqueOrThrow({ where: { namespace_key: where } })
      ).value,
      audits: await prisma.adminAuditLog.findMany({
        where: { actorAccountId: input.accountId, action: "PRODUCT_CONTROLS_UPDATED" },
        orderBy: { createdAt: "asc" },
      }),
      row: await prisma.homeRowConfig.findFirst({
        where: { key: "e2e-product-controls-region" },
        include: { regionTargets: true },
      }),
    };
  } else if (command === "revoke") {
    await prisma.adminRoleAssignment.deleteMany({ where: { accountId: input.accountId } });
    result = { ok: true };
  } else throw new Error("Unknown product controls fixture command");
  console.log(JSON.stringify(result));
} finally {
  await prisma.$disconnect();
}
