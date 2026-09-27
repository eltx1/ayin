import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

// Source inventory only: matches are evidence candidates, never runtime acceptance.
const files = execFileSync("git", ["ls-files"], { encoding: "utf8" }).trim().split("\n");
const text = (path) => readFileSync(path, "utf8");
const source = files.filter((path) => /\.(tsx?|mjs|js|swift|kt|prisma|css|md|yml|xml)$/.test(path));
const routes = files
  .filter((path) => /^apps\/web\/src\/app\/.*\/(page\.tsx|route\.ts)$/.test(path))
  .map((path) => ({
    route:
      "/" +
      path
        .replace("apps/web/src/app/", "")
        .split("/")
        .slice(0, -1)
        .filter((part) => !part.startsWith("("))
        .join("/"),
    file: path,
    kind: path.endsWith("page.tsx") ? "page" : "handler",
    imports: [...text(path).matchAll(/from ["']([^"']+)["']/g)].map((match) => match[1]),
    runtimeVerified: false,
  }));
const controllers = files.filter(
  (path) => path.startsWith("apps/api/src/") && path.endsWith(".controller.ts"),
);
const endpoints = controllers.flatMap((file) => {
  const value = text(file);
  const blocks = [...value.matchAll(/@Controller\((?:["']([^"']*)["'])?\)/g)];
  return blocks.flatMap((block, index) => {
    const body = value.slice(block.index, blocks[index + 1]?.index ?? value.length);
    return [...body.matchAll(/@(Get|Post|Put|Patch|Delete)\(([^)]*)\)/g)].flatMap((method) => {
      const paths = [...method[2].matchAll(/["']([^"']*)["']/g)].map((path) => path[1]);
      if (method[2].trim() && paths.length === 0) {
        throw new Error(`Review unsupported route decorator in ${file}: ${method[0]}`);
      }
      return (paths.length ? paths : [""]).map((path) => ({
        method: method[1].toUpperCase(),
        route: "/" + [block[1], path].filter(Boolean).join("/"),
        file,
        authorization:
          "Inspect class and method guards; static inventory is not proof of access control",
      }));
    });
  });
});
const definitions = [
  [
    "Authentication",
    "auth|login|register|password",
    "Viewer",
    "Verify all failure and recovery states",
  ],
  ["Sessions", "session|auth", "Viewer", "Account switching, revocation and cache isolation"],
  ["MFA", "mfa|admin.guard", "Viewer/Admin", "Preserve step-up and least-privileged flows"],
  [
    "Accounts",
    "account|auth|privacy",
    "Viewer/Admin",
    "Responsive account settings and deletion/export",
  ],
  ["Profiles", "profile|auth|discovery", "Viewer", "Profile isolation and Kids transition"],
  ["Channels", "channel", "Viewer/Creator/Admin", "Canonical channel navigation"],
  ["Uploads", "upload", "Creator", "Broken manifest shortcut; progressive disclosure"],
  [
    "Media processing",
    "media-processing",
    "Admin/internal",
    "Detailed operations API lacks adequate UI",
  ],
  ["R2", "r2|media-storage", "Internal", "Keep credentials and object operations private"],
  ["FFmpeg", "ffmpeg|media-processing", "Internal", "Retain worker/runtime boundaries"],
  ["HLS", "adaptive|hls", "Viewer/Admin", "Operator rollout and recovery surface gap"],
  [
    "Adaptive playback",
    "adaptive-playback|ayin-player",
    "Viewer",
    "Capability and failure-path verification",
  ],
  ["Playback fallback", "playback|ayin-player", "Viewer", "Preserve MP4 fallback and ad hooks"],
  ["Player", "player|watch", "Viewer", "Keyboard, touch, captions, TV focus"],
  ["Watch progress", "watch|progress", "Viewer", "Cross-profile and native accounting consistency"],
  ["History", "discovery|my-ayin", "Viewer", "Policy-filtered pagination and empty states"],
  ["My AYIN", "my-ayin|discovery", "Viewer", "Library navigation and context preservation"],
  ["Playlists", "playlist", "Viewer/Creator", "Creator route duplication review"],
  [
    "Creator TV",
    "creator-tv|linear-output",
    "Viewer/Creator/Admin",
    "Top-level TV destination is placeholder",
  ],
  ["Movies", "movie", "Viewer/Admin", "Top-level Movies destination is placeholder"],
  ["Series", "series", "Viewer/Admin", "Top-level Series destination is placeholder"],
  ["Episodes", "series|episode", "Viewer/Admin", "Continue and next-episode journey"],
  ["Clips", "clips|shorts", "Viewer/Creator", "Navigation /shorts disagrees with /clips"],
  ["Community", "community", "Viewer/Creator/Admin", "Review feed/poll/moderation state coverage"],
  ["Comments", "comment", "Viewer/Creator/Admin", "Contextual moderation and error states"],
  ["Social actions", "social|reaction", "Viewer", "Accessible action feedback"],
  ["Notifications", "notification|social", "Viewer", "Read/unread behavior and empty state"],
  ["Captions", "caption", "Viewer/Creator", "Upload/edit/playback/RTL coverage"],
  ["Chapters", "chapter|metadata", "Viewer/Creator", "Shared metadata/player contract"],
  ["Metadata", "metadata", "Creator/Admin", "Stale series-placeholder copy"],
  [
    "Rights",
    "video-policy|rights|trust",
    "Creator/Admin",
    "Never weaken policy during pagination fixes",
  ],
  ["Maturity", "video-policy|kids", "Viewer/Admin", "Age and Kids policy enforcement"],
  [
    "Geographic policy",
    "video-policy|regional|country",
    "Viewer/Admin",
    "Trusted region and unknown-region fail closed",
  ],
  ["Kids", "kids", "Viewer/Admin", "Dedicated safe navigation and ads"],
  ["Search", "search", "Viewer", "Preserve bounded query and policy enforcement"],
  ["Language-aware search", "search|i18n", "Viewer", "Arabic query and result validation"],
  ["Lens", "lens", "Viewer", "Lexical fallback; no invented provider availability"],
  [
    "Recommendations",
    "recommendation",
    "Viewer/Admin",
    "Ranking controls versus viewer simplicity",
  ],
  [
    "Recommendation evaluation",
    "recommendation-eval",
    "Admin",
    "Ready evaluation APIs have no dedicated surface",
  ],
  ["Trending", "trending", "Admin/Viewer", "Dedicated configuration API lacks UI"],
  [
    "Regional discovery",
    "regional|admin-product",
    "Admin/Viewer",
    "Review merchandising fields and surfaced controls",
  ],
  [
    "Localization",
    "localization|i18n",
    "Viewer/Creator/Admin",
    "Catalog localized; Admin text still largely English",
  ],
  [
    "Arabic/RTL",
    "i18n|rtl",
    "Viewer/Creator/Admin",
    "Physical CSS offsets and mixed-language forms",
  ],
  ["Analytics", "analytics", "Creator/Admin", "Existing dashboards; verify definitions and states"],
  [
    "Cohorts",
    "cohort|analytics",
    "Creator/Admin",
    "Already surfaced in analytics; preserve privacy thresholds",
  ],
  [
    "Warehouse export",
    "warehouse",
    "Admin/internal",
    "Worker/internal export; status-only operator visibility useful",
  ],
  ["Live", "live", "Viewer/Creator", "Provider state, reconnect and unconfigured behavior"],
  [
    "FAST",
    "linear|fast|creator-tv",
    "Viewer/Creator/Admin",
    "Provider activation and status truth",
  ],
  ["SSAI/DAI", "ssai|dai", "Viewer/Admin", "Runtime SDK support and external verification"],
  ["Page ads", "page-ad|gpt", "Viewer/Admin", "Preserve consent/no-fill collapse and kill switch"],
  ["Video ads", "video-ad|ima", "Viewer/Admin", "Preserve ad lifecycle across platforms"],
  [
    "Direct advertising",
    "advertising|direct",
    "Admin",
    "Existing controls; contextual entity selection",
  ],
  ["GAM", "gam", "Admin", "Diagnostics exist; real credentials/fill external"],
  ["Revenue", "revenue|ledger", "Creator/Admin", "Currency, precision and role isolation"],
  ["Reconciliation", "reconciliation", "Admin", "Existing imports; review status clarity"],
  ["Payouts", "payout", "Creator/Admin", "Provider readiness and safe financial mutations"],
  ["Compliance", "compliance", "Creator/Admin", "Existing surfaces; preserve sensitive-data scope"],
  ["Support", "support|governance", "Creator/Admin", "Contextual support workspace"],
  ["Moderation", "moderation|trust", "Creator/Admin", "Raw technical IDs still exposed in forms"],
  [
    "Trust & Safety",
    "trust|video-policy",
    "Creator/Admin",
    "Searchable targets without weaker enforcement",
  ],
  ["SEO", "seo|sitemap|robots", "Viewer/internal", "Align canonical browse and alias routes"],
  ["Sitemaps", "sitemap", "Internal", "No private or placeholder routes"],
  ["Admin", "admin", "Admin", "Flat 19-link sidebar and repeated session fetches"],
  ["Observability", "observability", "Admin/internal", "API available; summary only in Operations"],
  ["Backups", "backup", "Admin/internal", "Local status evidence; restore drills external"],
  [
    "Synthetic monitoring",
    "synthetic",
    "Admin/internal",
    "External reports must not be fabricated",
  ],
  [
    "Media workers",
    "worker|media-processing",
    "Admin/internal",
    "Retain fencing and worker heartbeat truth",
  ],
  [
    "Database scaling",
    "postgres|database",
    "Admin/internal",
    "Detailed performance API not surfaced",
  ],
  [
    "Operations dashboard",
    "operations-dashboard|operations-cost",
    "Admin",
    "Task 87 summary integrated; workflow grouping remains",
  ],
  [
    "PWA",
    "pwa|sw.js|manifest",
    "Viewer",
    "Duplicate manifest, unsafe/boundless cache candidates, no offline navigation",
  ],
  ["Android", "android", "Platform", "Thin web shell; hardware/store evidence separate"],
  [
    "iOS",
    "ios",
    "Platform",
    "Independent SwiftUI ordinary UI conflicts with new Web/PWA-first goal",
  ],
  [
    "TV platforms",
    "tvos|tizen|webos|tv-focus|android",
    "Platform",
    "Native exceptions require technical evidence; device/store checks external",
  ],
];
const matches = (pattern, pool) => pool.filter((path) => new RegExp(pattern, "i").test(path));
const features = definitions.map(([feature, pattern, audience, gaps]) => {
  const evidence = matches(pattern, source);
  const backend = evidence.filter((p) => p.startsWith("apps/api/src/") && !p.includes(".test."));
  const frontend = evidence.filter((p) => p.startsWith("apps/web/src/") && !p.includes(".test."));
  return {
    feature,
    audience,
    backend,
    database: matches(
      pattern,
      files.filter((p) => p.startsWith("packages/db/prisma/")),
    ),
    api: endpoints.filter((e) => new RegExp(pattern, "i").test(e.file + " " + e.route)),
    frontend,
    viewerUi: frontend.filter((p) => !/admin|studio/.test(p)),
    creatorUi: frontend.filter((p) => /studio|creator|upload|channel/.test(p)),
    adminUi: frontend.filter((p) => /admin/.test(p)),
    pwa: "Shared web runtime; dedicated verification pending",
    mobileWeb: "Responsive implementation present; route-level visual verification pending",
    tvWeb: "Shared focus/media adapters; device verification pending",
    tests: matches(
      pattern,
      files.filter((p) => /test|spec/.test(p)),
    ),
    documentation: matches(
      pattern,
      files.filter((p) => p.startsWith("docs/") && p.endsWith(".md")),
    ),
    status: "SOURCE_INVENTORIED_RUNTIME_REVIEW_REQUIRED",
    gaps,
    evidenceMethod:
      "Filename/route matching finds candidates; it does not establish semantic completeness or runtime correctness",
  };
});
const schema = files.filter(
  (path) => path.startsWith("packages/db/prisma/") && path.endsWith(".prisma"),
);
const result = {
  schemaVersion: 1,
  sourceSha: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  sourceShaMeaning:
    "HEAD at generation; inventory reads tracked worktree contents, including changes listed below",
  sourceWorkingTreeChanges: execFileSync("git", ["diff", "--name-only", "HEAD"], {
    encoding: "utf8",
  })
    .trim()
    .split("\n")
    .filter((file) => file && file !== "docs/AYIN_PRODUCT_INTEGRATION_MATRIX.json")
    .sort(),
  method:
    "Deterministic tracked-source inventory; no runtime, authorization or feature-completion claims",
  counts: {
    files: files.length,
    routes: routes.length,
    pages: routes.filter((r) => r.kind === "page").length,
    controllers: controllers.length,
    endpoints: endpoints.length,
    features: features.length,
  },
  routes,
  endpoints,
  features,
  models: schema.flatMap((file) =>
    [...text(file).matchAll(/^model (\w+)/gm)].map((m) => ({ model: m[1], file })),
  ),
  migrations: files.filter((p) => /prisma\/migrations\/.*\/migration.sql$/.test(p)),
  workers: files.filter(
    (p) => /worker/.test(p) && p.startsWith("apps/api/src/") && !p.includes(".test."),
  ),
  platformFiles: files.filter((p) => p.startsWith("platforms/")),
  deploymentFiles: files.filter(
    (p) => p.startsWith("deploy/") || p.startsWith(".github/workflows/"),
  ),
  flags: files.filter((p) => /feature-flag/.test(p)),
  reviewCandidates: source
    .filter((p) => /^(apps|packages)\//.test(p))
    .flatMap((file) =>
      text(file)
        .split("\n")
        .flatMap((line, index) =>
          /\bTODO\b|\bFIXME\b|\bHACK\b|Ready for the next layer|series.*placeholder/i.test(line)
            ? [{ file, line: index + 1, text: line.trim().slice(0, 200) }]
            : [],
        ),
    ),
};
const review = JSON.parse(text("docs/AYIN_PRODUCT_INTEGRATION_SEMANTIC_REVIEW.json"));
const classified = new Set();
for (const domain of review.domains) {
  for (const file of domain.backend) {
    if (!existsSync(`apps/api/src/${file}`)) throw new Error(`Missing reviewed source: ${file}`);
  }
  for (const model of domain.models) {
    if (!result.models.some((entry) => entry.model === model)) {
      throw new Error(`Missing reviewed model: ${model}`);
    }
  }
  for (const name of domain.features) {
    const feature = features.find((entry) => entry.feature === name);
    if (!feature || classified.has(name)) throw new Error(`Invalid reviewed feature: ${name}`);
    classified.add(name);
    const { features: _names, ...semanticReview } = domain;
    feature.semanticReview = semanticReview;
  }
}
if (classified.size !== features.length) throw new Error("Semantic review must cover every domain");
const responsiveSource = text("tests/e2e/responsive.acceptance.spec.ts");
const responsiveRoutes = responsiveSource.split("for (const route of [")[1].split("])")[0];
for (const route of result.routes) {
  const ancestors = [];
  let directory = path.dirname(route.file);
  while (directory.startsWith("apps/web/src/app")) {
    ancestors.push(directory);
    directory = path.dirname(directory);
  }
  route.sourceReview = {
    surface: route.route.startsWith("/admin")
      ? "Admin"
      : route.route.startsWith("/studio") ||
          route.route.startsWith("/channel/") ||
          route.route === "/upload"
        ? "Creator"
        : "Viewer/public",
    layoutFiles: ancestors.map((folder) => `${folder}/layout.tsx`).filter(existsSync),
    errorBoundaryFiles: ancestors.map((folder) => `${folder}/error.tsx`).filter(existsSync),
    loadingBoundaryFiles: ancestors.map((folder) => `${folder}/loading.tsx`).filter(existsSync),
    baselineMobileOverflowTest:
      route.kind === "page" &&
      (responsiveRoutes.includes(`"${route.route}"`) || route.route === "/c/[handle]"),
    baselineArabicAssertions: ["/login", "/search", "/watch/[slug]"].includes(route.route),
    roleReview: route.route.startsWith("/admin")
      ? "Server AdminGuard and scoped roles remain authoritative; per-action step-up review required"
      : route.route.startsWith("/studio") ||
          route.route.startsWith("/channel/") ||
          ["/account", "/my-ayin", "/upload", "/notifications"].includes(route.route)
        ? "Private data/mutations require server session and ownership checks; shared layouts are not authorization boundaries"
        : "Public reads must preserve publication, rights, region and Kids policy where relevant",
    keyboardRtlReview:
      "Root i18n/direction and global focus styles present; route-family visual, label, focus-order and mixed-direction verification is a Phase 5 acceptance item",
    stateReview:
      route.route === "/[section]"
        ? "Known placeholder destinations R01/R03; explicit routes take precedence"
        : "Inspect mounted component loading/empty/error states; API failures must not be mistaken for not-found or empty data",
  };
}
writeFileSync("docs/AYIN_PRODUCT_INTEGRATION_MATRIX.json", JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result.counts));
