import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile("platforms/tizen/bootstrap.js", "utf8");
const target = "https://ayin.stream/?platform=tizen&ayin_tizen_hosted=1";

function runBootstrap({ userAgent, online }) {
  const listeners = new Map();
  const redirects = [];
  const status = { textContent: "" };

  const window = {
    location: {
      replace(value) {
        redirects.push(value);
      },
    },
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
  };

  const context = vm.createContext({
    Number,
    document: {
      getElementById(id) {
        return id === "status" ? status : null;
      },
    },
    navigator: { userAgent, onLine: online },
    window,
  });

  vm.runInContext(source, context, { filename: "platforms/tizen/bootstrap.js" });

  return {
    redirects,
    status,
    goOnline() {
      context.navigator.onLine = true;
      listeners.get("online")?.();
    },
  };
}

{
  const result = runBootstrap({ userAgent: "SMART-TV; LINUX; Tizen 10.0", online: true });
  assert.deepEqual(result.redirects, [target]);
}

{
  const result = runBootstrap({ userAgent: "SMART-TV; LINUX; Tizen 9.0", online: true });
  assert.deepEqual(result.redirects, [target]);
}

{
  const result = runBootstrap({ userAgent: "SMART-TV; LINUX; Tizen 8.0", online: true });
  assert.deepEqual(result.redirects, []);
  assert.match(result.status.textContent, /not in the AYIN supported baseline/i);
}

{
  const result = runBootstrap({ userAgent: "Mozilla/5.0 Chrome/130", online: true });
  assert.deepEqual(result.redirects, []);
  assert.match(result.status.textContent, /could not identify/i);
}

{
  const result = runBootstrap({ userAgent: "SMART-TV; LINUX; Tizen 10.0", online: false });
  assert.deepEqual(result.redirects, []);
  assert.match(result.status.textContent, /Waiting for a network connection/i);
  result.goOnline();
  assert.deepEqual(result.redirects, [target]);
}

assert.equal(/\btizen\s*\./i.test(source), false, "Hosted bootstrap must not call Tizen APIs");
assert.equal(source.includes("http://"), false, "Hosted bootstrap must remain HTTPS-only");

console.log("Tizen hosted bootstrap tests passed.");
