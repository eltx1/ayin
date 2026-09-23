import { access, readFile } from "node:fs/promises";
import process from "node:process";

const tizen = await readFile("platforms/tizen/config.xml", "utf8");
const webos = JSON.parse(await readFile("platforms/webos/appinfo.json", "utf8"));
const tizenIndex = await readFile("platforms/tizen/index.html", "utf8");
const tizenBootstrap = await readFile("platforms/tizen/bootstrap.js", "utf8");
const webosIndex = await readFile("platforms/webos/index.html", "utf8");

const tizenRequiredNeedles = [
  '<tizen:profile name="tv-samsung"',
  '<content src="index.html"',
  '<icon src="icon.png"',
  '<feature name="http://tizen.org/feature/screen.size.normal.1080.1920"',
  'required_version="9.0"',
  "http://tizen.org/privilege/internet",
  "http://tizen.org/privilege/tv.inputdevice",
  "http://developer.samsung.com/privilege/adinfo",
  'origin="https://ayin.stream"',
  'origin="https://api.ayin.stream"',
  'origin="https://media.ayin.stream"',
  'origin="https://imasdk.googleapis.com"',
  'origin="https://doubleclick.net"',
  'origin="https://googletagservices.com"',
  'origin="https://googlesyndication.com"',
  'pointing-device-support="disable"',
];

for (const needle of tizenRequiredNeedles) {
  if (!tizen.includes(needle)) throw new Error(`Tizen config missing ${needle}`);
}

if (/\<access\s+origin="http:\/\//u.test(tizen)) {
  throw new Error("Tizen network access must not allow cleartext HTTP origins");
}
if (tizen.includes("http://developer.samsung.com/privilege/drmplay")) {
  throw new Error("Tizen package must not request AVPlay DRM privilege while AYIN uses HTML5 media");
}
if (!/version="\d+\.\d+\.\d+"/u.test(tizen)) {
  throw new Error("Tizen widget version must be x.y.z");
}

for (const key of ["id", "title", "type", "main", "version", "icon"]) {
  if (!webos[key]) throw new Error(`webOS appinfo missing ${key}`);
}
if (webos.type !== "web") throw new Error("webOS type must be web");
if (webos.main !== "index.html") throw new Error("webOS main must be index.html");
if (!/^\d+\.\d+\.\d+$/.test(webos.version)) throw new Error("webOS version must be x.y.z");
if (!tizenIndex.includes('src="bootstrap.js"'))
  throw new Error("Tizen entrypoint must load the packaged bootstrap");
if (!tizenBootstrap.includes("https://ayin.stream/?platform=tizen"))
  throw new Error("Tizen bootstrap must target canonical AYIN origin");
for (const key of [
  "MediaPlayPause",
  "MediaPlay",
  "MediaPause",
  "MediaRewind",
  "MediaFastForward",
]) {
  if (!tizenBootstrap.includes(key)) throw new Error(`Tizen bootstrap missing remote key ${key}`);
}
if (!webosIndex.includes("https://ayin.stream/?platform=webos"))
  throw new Error("webOS entrypoint must target canonical AYIN origin");

await access("platforms/tizen/icon.png");

if (process.env.AYIN_TV_REQUIRE_STORE_ASSETS === "1") {
  await access("platforms/webos/icon.png");
  await access("platforms/webos/largeIcon.png");
}

console.log("TV package manifests are structurally valid.");
