import { randomUUID } from "node:crypto";
import { createPrismaClient } from "../../packages/db/dist/index.js";
const url = new URL(process.env.TEST_DATABASE_URL ?? "");
if (!["127.0.0.1", "localhost"].includes(url.hostname) || url.pathname !== "/ayin_e2e")
  throw Error("Requires isolated local ayin_e2e");
const prisma = createPrismaClient(url.toString());
const [command, raw = "{}"] = process.argv.slice(2),
  input = JSON.parse(raw);
try {
  if (command === "seed") {
    const group = randomUUID().replaceAll("-", "");
    const names = [
      "A worldwide creator collection with a deliberately long documentary title and original independent stories",
      "قناةللأفلاموالحكاياتالعالمية".repeat(4),
      "Neighbour creator",
    ];
    const records = [];
    for (let index = 0; index < names.length; index++) {
      const record = await prisma.channel.create({
        data: {
          id: `00000000-0000-4000-800${index}-${group.slice(0, 12)}`,
          name: names[index].slice(0, 120),
          handle: `card-${index}-${group}${"f".repeat(32)}`,
        },
      });
      records.push({ id: record.id, name: record.name, handle: record.handle });
    }
    console.log(JSON.stringify({ records }));
  } else if (command === "cleanup") {
    if (
      !Array.isArray(input.records) ||
      input.records.length !== 3 ||
      input.records.some((record) => !/^00000000-0000-4000-800[0-2]-[0-9a-f]{12}$/.test(record.id))
    )
      throw Error("Expected only this fixture's three channel IDs");
    await prisma.channel.deleteMany({
      where: { id: { in: input.records.map((record) => record.id) } },
    });
    console.log(JSON.stringify({ removed: true }));
  } else throw Error("Unknown fixture command");
} finally {
  await prisma.$disconnect();
}
