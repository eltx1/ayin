import fs from "node:fs";

const [inventoryPath, outputPath] = process.argv.slice(2);

if (!inventoryPath || !outputPath) {
  throw new Error(
    "Usage: node deploy/security/generate-sbom.mjs <pnpm-list.json> <output.json>",
  );
}

const inventory = JSON.parse(fs.readFileSync(inventoryPath, "utf8"));
const components = new Map();
const dependencyFields = ["dependencies", "optionalDependencies"];

function addComponent(node) {
  if (!node || typeof node !== "object" || Array.isArray(node)) return;

  if (typeof node.name === "string" && typeof node.version === "string") {
    const key = `${node.name}\u0000${node.version}`;
    if (node.name !== "ayin") {
      components.set(key, {
        type: "library",
        name: node.name,
        version: node.version,
      });
    }
  }

  for (const field of dependencyFields) {
    const dependencies = node[field];
    if (!dependencies || typeof dependencies !== "object") continue;
    for (const dependency of Object.values(dependencies)) {
      addComponent(dependency);
    }
  }
}

for (const workspace of Array.isArray(inventory) ? inventory : [inventory]) {
  addComponent(workspace);
}

const bom = {
  bomFormat: "CycloneDX",
  specVersion: "1.6",
  version: 1,
  metadata: {
    timestamp: new Date().toISOString(),
    component: {
      type: "application",
      name: "ayin",
      version: "0.0.0",
    },
  },
  components: [...components.values()].sort((left, right) => {
    const byName = left.name.localeCompare(right.name);
    return byName || left.version.localeCompare(right.version);
  }),
};

const serialized = `${JSON.stringify(bom, null, 2)}\n`;
const forbiddenCredentialPatterns = [
  /(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s"']+:[^@\s"']+@/i,
  /gh[pousr]_[A-Za-z0-9]{20,}/,
  /AKIA[0-9A-Z]{16}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
];

for (const pattern of forbiddenCredentialPatterns) {
  if (pattern.test(serialized)) {
    throw new Error(
      "Refusing to write an SBOM containing credential-like data.",
    );
  }
}

fs.writeFileSync(outputPath, serialized, { mode: 0o600 });
console.log(
  `Generated sanitized CycloneDX SBOM with ${components.size} components.`,
);
