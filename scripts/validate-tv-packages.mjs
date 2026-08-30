import { access, readFile } from "node:fs/promises";
import process from "node:process";

const tizen = await readFile("platforms/tizen/config.xml", "utf8");
const webos = JSON.parse(await readFile("platforms/webos/appinfo.json", "utf8"));
const tizenIndex = await readFile("platforms/tizen/index.html", "utf8");
const webosIndex = await readFile("platforms/webos/index.html", "utf8");

for (const needle of [
  '<tizen:profile name="tv-samsung"',
  '<content src="index.html"',
  'http://tizen.org/privilege/tv.inputdevice',
  'https://ayin.stream',
]) {
  if (!tizen.includes(needle)) throw new Error(`Tizen config missing ${needle}`);
}

for (const key of ["id", "title", "type", "main", "version", "icon"]) {
  if (!webos[key]) throw new Error(`webOS appinfo missing ${key}`);
}
if (webos.type !== "web") throw new Error("webOS type must be web");
if (webos.main !== "index.html") throw new Error("webOS main must be index.html");
if (!/^\d+\.\d+\.\d+$/.test(webos.version)) throw new Error("webOS version must be x.y.z");
if (!tizenIndex.includes("https://ayin.stream/?platform=tizen")) throw new Error("Tizen entrypoint must target canonical AYIN origin");
if (!webosIndex.includes("https://ayin.stream/?platform=webos")) throw new Error("webOS entrypoint must target canonical AYIN origin");

if (process.env.AYIN_TV_REQUIRE_STORE_ASSETS === "1") {
  await access("platforms/webos/icon.png");
  await access("platforms/webos/largeIcon.png");
  await access("platforms/tizen/icon.png");
}

console.log("TV package manifests are structurally valid.");
