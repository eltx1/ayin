import { access, readFile } from "node:fs/promises";
import process from "node:process";

const tizen = await readFile("platforms/tizen/config.xml", "utf8");
const tizenIndex = await readFile("platforms/tizen/index.html", "utf8");
const tizenShell = await readFile("platforms/tizen/shell.js", "utf8");
const tizenCss = await readFile("platforms/tizen/shell.css", "utf8");
const webConfig = await readFile("apps/web/next.config.ts", "utf8");
const webos = JSON.parse(await readFile("platforms/webos/appinfo.json", "utf8"));
const webosIndex = await readFile("platforms/webos/index.html", "utf8");

for (const needle of [
  '<tizen:profile name="tv-samsung"',
  '<content src="index.html"',
  'required_version="9.0"',
  'http://samsung.com/tv/metadata/devel.api.version" value="9.0"',
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

if (tizenIndex.includes("location.replace(")) {
  throw new Error("Tizen package must not regress to a hosted-app redirect");
}
for (const needle of [
  'id="ayin-app"',
  "https://ayin.stream/?platform=tizen&amp;ayin_tizen_embed=1",
  'allow="autoplay; fullscreen"',
  'src="shell.js"',
  'href="shell.css"',
  'id="exit-dialog"',
]) {
  if (!tizenIndex.includes(needle)) throw new Error(`Tizen shell HTML missing ${needle}`);
}

for (const needle of [
  'var EXIT_KEY = 10182',
  "registerKeyBatch(MEDIA_KEYS)",
  '10009: "BACK"',
  '10252: "PLAY_PAUSE"',
  'source: SHELL_SOURCE, type: "lifecycle"',
  'source: SHELL_SOURCE, type: "network"',
  'data.type === "exit-request"',
  "getCurrentApplication().exit()",
]) {
  if (!tizenShell.includes(needle)) throw new Error(`Tizen shell adapter missing ${needle}`);
}

const mediaKeyArray =
  tizenShell.match(/var MEDIA_KEYS = \[([\s\S]*?)\];/)?.[1] ??
  (() => {
    throw new Error("Tizen MEDIA_KEYS declaration missing");
  })();
if (/["'](?:Exit|Back)["']/.test(mediaKeyArray)) {
  throw new Error("Tizen shell must not register Back/Exit; Samsung owns the Exit long-press");
}

if (!tizenCss.includes("#exit-dialog") || !tizenCss.includes("#ayin-app")) {
  throw new Error("Tizen shell CSS is incomplete");
}

for (const needle of [
  'TIZEN_EMBED_COOKIE = "ayin_tizen_embed"',
  "frame-ancestors 'self' file: tizen-widget:",
  'header.key !== "X-Frame-Options"',
]) {
  if (!webConfig.includes(needle)) {
    throw new Error(`AYIN Tizen framing policy missing ${needle}`);
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

console.log("TV package manifests and Tizen packaged-shell policy are structurally valid.");
