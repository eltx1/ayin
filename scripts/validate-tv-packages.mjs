import { access, readFile } from "node:fs/promises";
import process from "node:process";
import vm from "node:vm";

const tizen = await readFile("platforms/tizen/config.xml", "utf8");
const tizenIndex = await readFile("platforms/tizen/index.html", "utf8");
const tizenBootstrap = await readFile("platforms/tizen/bootstrap.js", "utf8");
const webos = JSON.parse(await readFile("platforms/webos/appinfo.json", "utf8"));
const webosIndex = await readFile("platforms/webos/index.html", "utf8");

for (const needle of [
  '<tizen:profile name="tv-samsung"',
  '<tizen:application id="AYINtv2026.AYIN" package="AYINtv2026" required_version="9.0"',
  '<tizen:metadata key="http://samsung.com/tv/metadata/devel.api.version" value="9.0"',
  '<tizen:metadata key="http://samsung.com/tv/metadata/use.network" value="true"',
  '<feature name="http://tizen.org/feature/screen.size.normal.1080.1920"',
  '<feature name="http://tizen.org/feature/tv.inputdevice"',
  '<icon src="icon.png"',
  '<content src="index.html"',
  "http://tizen.org/privilege/internet",
  "http://tizen.org/privilege/tv.inputdevice",
  'background-support="disable"',
  'pointing-device-support="disable"',
  'hwkey-event="enable"',
  '<access origin="https://ayin.stream" subdomains="true"',
]) {
  if (!tizen.includes(needle)) throw new Error(`Tizen config missing ${needle}`);
}

for (const origin of [
  "https://doubleclick.net",
  "https://googleapis.com",
  "https://googletagservices.com",
  "https://googlesyndication.com",
]) {
  if (!tizen.includes(`<access origin="${origin}" subdomains="true"`)) {
    throw new Error(`Tizen config missing WARP access for ${origin}`);
  }
}

if (tizen.includes('origin="http://')) {
  throw new Error("Tizen package WARP policy must remain HTTPS-only");
}
if (tizenIndex.includes("<iframe")) {
  throw new Error("Tizen hosted entrypoint must not embed AYIN in an iframe");
}
if (tizenIndex.includes("location.replace(") || tizenIndex.includes("location.assign(")) {
  throw new Error("Tizen index navigation must stay in external bootstrap.js");
}
if (!tizenIndex.includes('src="bootstrap.js"')) {
  throw new Error("Tizen hosted HTML must load bootstrap.js");
}

for (const needle of [
  'var TARGET_URL = "https://ayin.stream/?platform=tizen&hosted=1"',
  "getSupportedKeys",
  "registerKeyBatch",
  'navigationType() === "back_forward"',
  "getCurrentApplication().exit()",
  'window.addEventListener("pageshow", onPageShow)',
  "window.location.assign(TARGET_URL)",
]) {
  if (!tizenBootstrap.includes(needle)) {
    throw new Error(`Tizen packaged bootstrap missing ${needle}`);
  }
}
if (tizenBootstrap.includes("http://")) {
  throw new Error("Tizen packaged bootstrap must remain HTTPS-only");
}

simulatePackagedBootstrap(tizenBootstrap);
await access("platforms/tizen/icon.png");

const certification = JSON.parse(
  await readFile("platforms/tizen/CERTIFICATION_STATUS.json", "utf8"),
);
if (certification.task !== 78) throw new Error("Tizen certification status task must be 78");
if (certification.packageMode !== "hosted-redirect") {
  throw new Error("Tizen certification status must match the hosted application architecture");
}
if (certification.declaredMinimumTizen !== "9.0") {
  throw new Error("Tizen certification baseline must remain 9.0");
}
if (certification.developmentPackageId !== "AYINtv2026") {
  throw new Error("Tizen certification package ID does not match config.xml");
}
if (!/^[0-9A-Za-z]{10}$/.test(certification.developmentPackageId)) {
  throw new Error("Tizen package ID must be exactly 10 alphanumeric characters");
}
if (certification.developmentApplicationId !== "AYINtv2026.AYIN") {
  throw new Error("Tizen certification application ID does not match config.xml");
}
if (certification.tizenApisAvailableInHostedContent !== false) {
  throw new Error("Hosted AYIN content must not claim access to Tizen APIs");
}
if (certification.packagedBootstrapUsesTizenApis !== true) {
  throw new Error("Packaged Tizen bootstrap API usage must be explicit");
}
if (certification.mediaKeyRegistrationDeviceVerified !== false) {
  throw new Error("Media-key registration cannot be called device verified by repository CI");
}
if (certification.hostedScreensaverApiAvailable !== false) {
  throw new Error("Hosted AYIN must not claim Samsung AppCommon/screensaver API access");
}
if (certification.screensaverPlaybackControlDeviceVerified !== false) {
  throw new Error("Screensaver playback control cannot be called device verified by repository CI");
}
if (typeof certification.verification?.repositoryValidation !== "boolean") {
  throw new Error("repositoryValidation must be explicit");
}
if (certification.verification.repositoryValidation) {
  for (const evidence of [
    "tvPackageRun",
    "qualityRun",
    "browserAcceptanceRun",
    "securityRun",
    "sharedAndroidRegressionRun",
  ]) {
    const value = certification.repositoryValidationEvidence?.[evidence];
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`repositoryValidation=true requires a positive ${evidence} run ID`);
    }
  }
}
for (const stage of [
  "simulatorVerified",
  "emulatorVerified",
  "realDeviceVerified",
  "storeSubmitted",
  "storeApproved",
]) {
  if (certification.verification?.[stage] !== false) {
    throw new Error(`Tizen stage ${stage} cannot be claimed complete by repository CI`);
  }
}

for (const key of ["id", "title", "type", "main", "version", "icon"]) {
  if (!webos[key]) throw new Error(`webOS appinfo missing ${key}`);
}
if (webos.type !== "web") throw new Error("webOS type must be web");
if (webos.main !== "index.html") throw new Error("webOS main must be index.html");
if (!/^\d+\.\d+\.\d+$/.test(webos.version)) {
  throw new Error("webOS version must be x.y.z");
}
if (!webosIndex.includes("https://ayin.stream/?platform=webos")) {
  throw new Error("webOS entrypoint must target canonical AYIN origin");
}

if (process.env.AYIN_TV_REQUIRE_STORE_ASSETS === "1") {
  await access("platforms/webos/icon.png");
  await access("platforms/webos/largeIcon.png");
  await access("platforms/tizen/icon.png");
}

console.log("TV package manifests and Task 78 Tizen hosted baseline are structurally valid.");

function simulatePackagedBootstrap(source) {
  const registered = [];
  const assigned = [];
  let exitCount = 0;

  const makeWindow = (navigationType) => ({
    addEventListener: () => undefined,
    performance: { getEntriesByType: () => [{ type: navigationType }] },
    location: { assign: (url) => assigned.push(url) },
    setTimeout: () => 1,
    clearTimeout: () => undefined,
    tizen: {
      tvinputdevice: {
        getSupportedKeys: () => [
          { name: "MediaPlayPause" },
          { name: "MediaPlay" },
          { name: "ColorF0Red" },
        ],
        registerKeyBatch: (keys, success) => {
          registered.push(...keys);
          success?.();
        },
      },
      application: {
        getCurrentApplication: () => ({
          exit: () => {
            exitCount += 1;
          },
        }),
      },
    },
  });

  const document = {
    readyState: "complete",
    addEventListener: () => undefined,
  };

  vm.runInNewContext(source, { document, window: makeWindow("navigate") });
  if (assigned[0] !== "https://ayin.stream/?platform=tizen&hosted=1") {
    throw new Error("Tizen bootstrap did not navigate to the canonical hosted AYIN URL");
  }
  if (registered.join(",") !== "MediaPlayPause,MediaPlay") {
    throw new Error("Tizen bootstrap did not filter registration to supported media keys");
  }

  assigned.length = 0;
  registered.length = 0;
  vm.runInNewContext(source, { document, window: makeWindow("back_forward") });
  if (exitCount !== 1) {
    throw new Error("Tizen bootstrap did not exit when returning from hosted AYIN");
  }
  if (assigned.length !== 0) {
    throw new Error("Tizen bootstrap relaunched hosted AYIN instead of exiting");
  }

  const noApiAssigned = [];
  const noApiWindow = {
    addEventListener: () => undefined,
    performance: { getEntriesByType: () => [{ type: "navigate" }] },
    location: { assign: (url) => noApiAssigned.push(url) },
    setTimeout: () => 1,
    clearTimeout: () => undefined,
    tizen: undefined,
  };
  vm.runInNewContext(source, { document, window: noApiWindow });
  if (noApiAssigned[0] !== "https://ayin.stream/?platform=tizen&hosted=1") {
    throw new Error("Tizen bootstrap must fail open to hosted AYIN when APIs are unavailable");
  }
}
