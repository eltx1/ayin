import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";

// Inspect trusted local Next build artifacts. This is entry-file aggregation,
// not all dynamic imports, HTTP transfer, hydration or Core Web Vitals.
const [buildPath, ...routes] = process.argv.slice(2);
if (!buildPath || !routes.length)
  throw new Error(
    "Usage: node scripts/measure-next-entry-bytes.mjs <.next> <manifest-route> [...]",
  );
const root = path.resolve(buildPath);
function within(relative) {
  const filename = path.resolve(root, relative);
  if (!filename.startsWith(`${root}${path.sep}`)) throw new Error("Build path traversal");
  return filename;
}
function entries(files) {
  return [...new Set(files)].sort().map((filename) => {
    if (!/^static\/.*\.(js|css)$/.test(filename))
      throw new Error(`Unexpected entry file ${filename}`);
    const bytes = readFileSync(within(filename));
    return {
      file: filename,
      rawBytes: bytes.length,
      gzipBytes: gzipSync(bytes, { level: 9 }).length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  });
}
const results = routes.map((route) => {
  if (!route.startsWith("/") || route.split("/").includes(".."))
    throw new Error("Invalid manifest route");
  const filename = within(`server/app/${route.slice(1)}_client-reference-manifest.js`);
  const context = {};
  vm.runInNewContext(readFileSync(filename, "utf8"), context, { timeout: 1000, filename });
  const manifest = context.__RSC_MANIFEST?.[route];
  if (!manifest?.entryJSFiles || !manifest?.entryCSSFiles)
    throw new Error(`Missing entries for ${route}`);
  const js = entries(Object.values(manifest.entryJSFiles).flat());
  const css = entries(
    Object.values(manifest.entryCSSFiles)
      .flat()
      .map((entry) => {
        if (entry.inlined) throw new Error("Inlined CSS requires a separate measurement method");
        return entry.path;
      }),
  );
  return {
    route,
    jsGzipBytes: js.reduce((sum, entry) => sum + entry.gzipBytes, 0),
    cssGzipBytes: css.reduce((sum, entry) => sum + entry.gzipBytes, 0),
    js,
    css,
  };
});
process.stdout.write(
  `${JSON.stringify({ schemaVersion: 1, method: "deduplicated-next-entry-files-gzip-level-9", node: process.version, buildId: readFileSync(within("BUILD_ID"), "utf8").trim(), results }, null, 2)}\n`,
);
