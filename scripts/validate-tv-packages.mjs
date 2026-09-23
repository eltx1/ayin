import { access, readFile } from "node:fs/promises";
import process from "node:process";

const tizen = await readFile("platforms/tizen/config.xml", "utf8");
const webos = JSON.parse(await readFile("platforms/webos/appinfo.json", "utf8"));
const tizenIndex = await readFile("platforms/tizen/index.html", "utf8");
const tizenBootstrap = await readFile("platforms/tizen/bootstrap.js", "utf8");
const tizenStatus = JSON.parse(
  await readFile("platforms/tizen/CERTIFICATION_STATUS.json", "utf8"),
);
const webosIndex = await readFile("platforms/webos/index.html", "utf8");

for (const needle of [
  '<tizen:profile name="tv-samsung"',
  '<content src="index.html"',
  '<icon src="icon.png"',
  '<feature name="http://tizen.org/feature/screen.size.normal.1080.1920"',
  'required_version="9.0"',
  "http://tizen.org/privilege/internet",
  'origin="https://ayin.stream"',
  'origin="https://api.ayin.stream"',
  'origin="https://media.ayin.stream"',
  'pointing-device-support="disable"',
]) {
  if (!tizen.includes(needle)) throw new Error(`Tizen config missing ${needle}`);
}

if (tizen.includes("http://tizen.org/privilege/tv.inputdevice")) {
  throw new Error("Hosted Tizen package must not claim TVInputDevice API access");
}
if (tizen.includes("http://developer.samsung.com/privilege/adinfo")) {
  throw new Error("Tizen package must not request adinfo without an implemented Product API use");
}
if (/<access\s+origin="http:\/\//u.test(tizen)) {
  throw new Error("Tizen network access must not allow cleartext HTTP origins");
}
if (!/version="\d+\.\d+\.\d+"/u.test(tizen)) {
  throw new Error("Tizen widget version must be x.y.z");
}
if (!tizenIndex.includes('src="bootstrap.js"')) {
  throw new Error("Tizen entrypoint must load the packaged bootstrap");
}
if (/<script(?![^>]*\bsrc=)[^>]*>/u.test(tizenIndex)) {
  throw new Error("Tizen hosted bootstrap must not contain inline script");
}
if (!tizenBootstrap.includes("https://ayin.stream/?platform=tizen")) {
  throw new Error("Tizen bootstrap must target canonical HTTPS AYIN origin");
}
if (tizenBootstrap.includes("window.tizen") || tizenBootstrap.includes("webapis.")) {
  throw new Error("Hosted bootstrap must not rely on Tizen/Product APIs");
}

if (tizenStatus.packageMode !== "hosted") throw new Error("Tizen package mode must be explicit");
if (tizenStatus.declaredMinimumTizen !== "9.0") {
  throw new Error("Tizen declared minimum must match config.xml");
}
if (tizenStatus.tizenApisAvailableInHostedContent !== false) {
  throw new Error("Hosted certification state must not claim Tizen API availability");
}
for (const stage of ["simulatorVerified", "emulatorVerified", "realDeviceVerified", "storeSubmitted", "storeApproved"]) {
  if (tizenStatus.verification?.[stage] !== false) {
    throw new Error(`Tizen certification stage ${stage} must remain false until actually completed`);
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

await access("platforms/tizen/icon.png");

if (process.env.AYIN_TV_REQUIRE_STORE_ASSETS === "1") {
  await access("platforms/webos/icon.png");
  await access("platforms/webos/largeIcon.png");
}

console.log("TV package manifests are structurally valid.");
