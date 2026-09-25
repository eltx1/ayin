import { access, readFile } from "node:fs/promises";
import process from "node:process";
import vm from "node:vm";

const tizen = await readFile("platforms/tizen/config.xml", "utf8");
const tizenIndex = await readFile("platforms/tizen/index.html", "utf8");
const tizenBootstrap = await readFile("platforms/tizen/bootstrap.js", "utf8");
const webos = JSON.parse(await readFile("platforms/webos/appinfo.json", "utf8"));
const webosIndex = await readFile("platforms/webos/index.html", "utf8");
const webosBootstrap = await readFile("platforms/webos/bootstrap.js", "utf8");
const webosCertification = JSON.parse(
  await readFile("platforms/webos/CERTIFICATION_STATUS.json", "utf8"),
);

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

for (const key of ["id", "title", "type", "main", "version", "icon", "largeIcon"]) {
  if (!webos[key]) throw new Error(`webOS appinfo missing ${key}`);
}
if (!/^[a-z0-9][a-z0-9.-]+$/.test(webos.id)) {
  throw new Error("webOS app ID must use LG-compatible lowercase reverse-DNS syntax");
}
if (webos.type !== "web") throw new Error("webOS type must be web");
if (webos.main !== "index.html") throw new Error("webOS main must be index.html");
if (!/^\d+\.\d+\.\d+$/.test(webos.version)) {
  throw new Error("webOS version must be x.y.z");
}
if (webos.resolution !== "1920x1080") {
  throw new Error("webOS package must declare the FHD app resolution");
}
if (webos.disableBackHistoryAPI !== true) {
  throw new Error("Task 79 requires explicit shared AYIN Back handling on webOS");
}
if (webos.handlesRelaunch !== false) {
  throw new Error("webOS must let the platform foreground AYIN automatically on relaunch");
}
if (typeof webos.requiredMemory !== "undefined") {
  throw new Error("Do not invent a webOS requiredMemory value; LG defines it as a minimum requirement");
}
if (webos.icon !== "icon.png" || webos.largeIcon !== "largeIcon.png") {
  throw new Error("webOS appinfo must reference the certified package icon filenames");
}
if (typeof webos.appDescription === "string" && webos.appDescription.length > 60) {
  throw new Error("webOS appDescription exceeds LG's 60-character limit");
}

if (!webosIndex.includes('src="bootstrap.js"')) {
  throw new Error("webOS hosted HTML must load bootstrap.js");
}
if (webosIndex.includes("location.replace(") || webosIndex.includes("location.href")) {
  throw new Error("webOS hosted navigation must stay in external bootstrap.js");
}
if (webosIndex.includes("<iframe")) {
  throw new Error("webOS hosted entrypoint must not iframe the shared AYIN product");
}
for (const needle of [
  'const TARGET_URL = "https://ayin.stream/?platform=webos&hosted=1"',
  "window.navigator.onLine === false",
  '"online"',
  "window.location.replace(TARGET_URL)",
]) {
  if (!webosBootstrap.includes(needle)) {
    throw new Error(`webOS packaged bootstrap missing ${needle}`);
  }
}
if (webosBootstrap.includes("http://")) {
  throw new Error("webOS packaged bootstrap must remain HTTPS-only");
}

await assertPngDimensions("platforms/webos/icon.png", 80, 80);
await assertPngDimensions("platforms/webos/largeIcon.png", 130, 130);

if (webosCertification.task !== 79) {
  throw new Error("webOS certification status task must be 79");
}
if (webosCertification.packageMode !== "hosted-redirect") {
  throw new Error("webOS certification status must match the hosted-app architecture");
}
if (webosCertification.declaredMinimumWebOsTv !== "25") {
  throw new Error("AYIN webOS zero-config baseline must remain TV 25");
}
if (webosCertification.minimumChromiumMajor !== 120) {
  throw new Error("webOS certification Chromium baseline must remain 120");
}
if (webosCertification.hostedUrl !== "https://ayin.stream/?platform=webos&hosted=1") {
  throw new Error("webOS certification hosted URL does not match bootstrap.js");
}
for (const stage of [
  "simulator25Verified",
  "simulator26Verified",
  "legacyEmulatorVerified",
  "realDevice25Verified",
  "realDevice26Verified",
  "adsDeviceVerified",
  "memoryDeviceVerified",
  "networkReconnectDeviceVerified",
  "sellerLoungeSubmitted",
  "storeApproved",
]) {
  if (webosCertification.verification?.[stage] !== false) {
    throw new Error(`webOS stage ${stage} cannot be claimed complete by repository CI`);
  }
}

if (process.env.AYIN_TV_REQUIRE_STORE_ASSETS === "1") {
  await access("platforms/webos/icon.png");
  await access("platforms/webos/largeIcon.png");
  await access("platforms/tizen/icon.png");
}

console.log(
  "TV package manifests, Task 78 Tizen baseline and Task 79 webOS hosted baseline are structurally valid.",
);

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


async function assertPngDimensions(path, expectedWidth, expectedHeight) {
  const data = await readFile(path);
  const signature = data.subarray(0, 8).toString("hex");
  if (signature !== "89504e470d0a1a0a") {
    throw new Error(`${path} is not a PNG file`);
  }
  const width = data.readUInt32BE(16);
  const height = data.readUInt32BE(20);
  if (width !== expectedWidth || height !== expectedHeight) {
    throw new Error(
      `${path} must be ${expectedWidth}x${expectedHeight}; found ${width}x${height}`,
    );
  }
}
