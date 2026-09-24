import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile("platforms/tizen/bootstrap.js", "utf8");
const target = "https://ayin.stream/?platform=tizen&hosted=1";

function runBootstrap({ navigationType = "navigate", withTizenApi = true } = {}) {
  const assigned = [];
  const registered = [];
  let exitCount = 0;
  const listeners = new Map();

  const window = {
    performance: {
      getEntriesByType(type) {
        return type === "navigation" ? [{ type: navigationType }] : [];
      },
    },
    location: {
      assign(value) {
        assigned.push(value);
      },
    },
    setTimeout(callback) {
      listeners.set("timeout", callback);
      return 1;
    },
    clearTimeout() {
      listeners.delete("timeout");
    },
    ...(withTizenApi
      ? {
          tizen: {
            tvinputdevice: {
              getSupportedKeys() {
                return [{ name: "MediaPlayPause" }, { name: "MediaPlay" }, { name: "ColorF0Red" }];
              },
              registerKeyBatch(keys, success) {
                registered.push(...keys);
                success?.();
              },
            },
            application: {
              getCurrentApplication() {
                return {
                  exit() {
                    exitCount += 1;
                  },
                };
              },
            },
          },
        }
      : { tizen: undefined }),
  };

  const document = {
    readyState: "complete",
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
  };

  vm.runInNewContext(source, { document, window }, { filename: "platforms/tizen/bootstrap.js" });
  return { assigned, registered, exitCount };
}

{
  const result = runBootstrap();
  assert.deepEqual(result.assigned, [target]);
  assert.deepEqual(result.registered, ["MediaPlayPause", "MediaPlay"]);
  assert.equal(result.exitCount, 0);
}

{
  const result = runBootstrap({ navigationType: "back_forward" });
  assert.deepEqual(result.assigned, []);
  assert.equal(result.exitCount, 1);
}

{
  const result = runBootstrap({ withTizenApi: false });
  assert.deepEqual(result.assigned, [target]);
  assert.deepEqual(result.registered, []);
}

assert.equal(source.includes("http://"), false, "Tizen bootstrap must remain HTTPS-only");
console.log("Task 78 packaged Tizen bootstrap tests passed.");
