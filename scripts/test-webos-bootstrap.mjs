import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const source = await readFile("platforms/webos/bootstrap.js", "utf8");
assert.equal(source.includes("http://"), false, "webOS bootstrap must remain HTTPS-only");

function run({ online }) {
  const replacements = [];
  const listeners = new Map();
  const statusNode = { textContent: "" };

  const window = {
    navigator: { onLine: online },
    location: { replace: (url) => replacements.push(url) },
    addEventListener: (type, callback, options) => listeners.set(type, { callback, options }),
  };
  const document = {
    readyState: "complete",
    getElementById: (id) => (id === "status" ? statusNode : null),
    addEventListener: () => undefined,
  };

  vm.runInNewContext(source, { document, window });
  return { listeners, replacements, statusNode, window };
}

const online = run({ online: true });
assert.deepEqual(online.replacements, ["https://ayin.stream/?platform=webos&hosted=1"]);

const offline = run({ online: false });
assert.deepEqual(offline.replacements, []);
assert.match(offline.statusNode.textContent, /internet/i);
const onlineListener = offline.listeners.get("online");
assert.ok(onlineListener, "offline bootstrap must register an online retry");
assert.equal(onlineListener.options?.once, true);
offline.window.navigator.onLine = true;
onlineListener.callback();
assert.deepEqual(offline.replacements, ["https://ayin.stream/?platform=webos&hosted=1"]);

console.log("webOS hosted bootstrap behavior is valid.");
