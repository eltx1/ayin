import { access, readFile } from "node:fs/promises";
import process from "node:process";

const tizen = await readFile("platforms/tizen/config.xml", "utf8");
const tizenIndex = await readFile("platforms/tizen/index.html", "utf8");
const tizenBootstrap = await readFile("platforms/tizen/bootstrap.js", "utf8");
const webos = JSON.parse(await readFile("platforms/webos/appinfo.json", "utf8"));
const webosIndex = await readFile("platforms/webos/index.html", "utf8");

for (const needle of [
  '<tizen:profile name="tv-samsung"',
  '<tizen:application id="AYINtv2026.AYIN" package="AYINtv2026" required_version="9.0"',
  '<tizen:metadata key="http://samsung.com/tv/metadata/devel.api.version" value="9.0"',
  '<feature name="http://tizen.org/feature/screen.size.normal.1080.1920"',
  '<icon src="icon.png"',
  '<content src="index.html"',
  "http://tizen.org/privilege/internet",
  'background-support="disable"',
  'pointing-device-support="disable"',
  'hwkey-event="enable"',
  '<access origin="https://ayin.stream" subdomains="true"',
]) {
  if (!tizen.includes(needle)) throw new Error(`Tizen config missing ${needle}`);
}

if (tizen.includes("http://tizen.org/privilege/tv.inputdevice")) {
  throw new Error(
    "Hosted Tizen package must not claim TVInputDevice privilege because Samsung hosted content cannot use Tizen APIs",
  );
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

if (tizenIndex.includes("<iframe")) {
  throw new Error("Tizen hosted entrypoint must not embed AYIN in an iframe");
}
if (tizenIndex.includes("location.replace(")) {
  throw new Error("Tizen index must keep hosted navigation in external bootstrap.js");
}
if (tizenIndex.includes("https://ayin.stream/?platform=tizen")) {
  throw new Error("Tizen index must not provide a manual URL that bypasses version checks");
}
for (const needle of ['id="status"', 'src="bootstrap.js"']) {
  if (!tizenIndex.includes(needle)) throw new Error(`Tizen hosted HTML missing ${needle}`);
}

for (const needle of [
  "var MIN_TIZEN_VERSION = 9",
  'var TARGET = "https://ayin.stream/?platform=tizen&ayin_tizen_hosted=1"',
  "navigator.userAgent",
  "navigator.onLine",
  'window.addEventListener("online", launch',
  "window.location.replace(TARGET)",
]) {
  if (!tizenBootstrap.includes(needle)) {
    throw new Error(`Tizen hosted bootstrap missing ${needle}`);
  }
}
if (/\btizen\s*\./iu.test(tizenBootstrap)) {
  throw new Error("Hosted bootstrap must not call Tizen APIs");
}
if (tizenBootstrap.includes("http://")) {
  throw new Error("Hosted bootstrap must remain HTTPS-only");
}

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
  throw new Error("Hosted content must not claim access to Tizen APIs");
}
if (certification.registeredMediaKeysAvailable !== false) {
  throw new Error("Hosted content must not claim registered media-key availability");
}
if (typeof certification.verification?.repositoryValidation !== "boolean") {
  throw new Error("repositoryValidation must be explicit");
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
if (!/^\d+\.\d+\.\d+$/.test(webos.version)) throw new Error("webOS version must be x.y.z");
if (!webosIndex.includes("https://ayin.stream/?platform=webos")) {
  throw new Error("webOS entrypoint must target canonical AYIN origin");
}

if (process.env.AYIN_TV_REQUIRE_STORE_ASSETS === "1") {
  await access("platforms/webos/icon.png");
  await access("platforms/webos/largeIcon.png");
  await access("platforms/tizen/icon.png");
}

console.log("TV package manifests and Tizen hosted baseline are structurally valid.");
