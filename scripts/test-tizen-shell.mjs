import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile("platforms/tizen/shell.js", "utf8");

function eventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, listener) {
      const bucket = listeners.get(type) ?? [];
      bucket.push(listener);
      listeners.set(type, bucket);
    },
    dispatch(type, event = {}) {
      for (const listener of listeners.get(type) ?? []) listener(event);
    },
  };
}

const windowTarget = eventTarget();
const documentTarget = eventTarget();
const frameTarget = eventTarget();
const noTarget = eventTarget();
const yesTarget = eventTarget();

const posted = [];
let exited = false;
let focused = 0;
let registeredKeys = [];
const contentWindow = {
  postMessage(payload, origin) {
    posted.push({ payload, origin });
  },
};

const elements = {
  "ayin-app": {
    ...frameTarget,
    contentWindow,
  },
  loading: { hidden: false, textContent: "Opening AYIN…" },
  "exit-dialog": { hidden: true },
  "exit-no": {
    ...noTarget,
    dataset: {},
  },
  "exit-yes": {
    ...yesTarget,
    dataset: {},
  },
};

const document = {
  ...documentTarget,
  hidden: false,
  body: {
    focus() {
      focused += 1;
    },
  },
  getElementById(id) {
    return elements[id] ?? null;
  },
};

const navigator = { onLine: true };
const tizen = {
  tvinputdevice: {
    registerKeyBatch(keys) {
      registeredKeys = [...keys];
    },
  },
  application: {
    getCurrentApplication() {
      return {
        exit() {
          exited = true;
        },
      };
    },
  },
};

const window = {
  ...windowTarget,
  tizen,
  setTimeout(callback) {
    callback();
    return 1;
  },
};

const context = vm.createContext({
  console,
  document,
  navigator,
  tizen,
  window,
});
vm.runInContext(source, context, { filename: "platforms/tizen/shell.js" });

assert.deepEqual(registeredKeys, [
  "MediaPlayPause",
  "MediaPlay",
  "MediaPause",
  "MediaRewind",
  "MediaFastForward",
]);
assert.equal(registeredKeys.includes("Back"), false);
assert.equal(registeredKeys.includes("Exit"), false);
assert.equal(focused > 0, true);

let prevented = false;
window.dispatch("keydown", {
  keyCode: 10252,
  preventDefault() {
    prevented = true;
  },
});
assert.equal(prevented, true);
assert.deepEqual(posted.at(-1), {
  payload: { source: "ayin-tizen-shell", type: "remote", key: "PLAY_PAUSE" },
  origin: "https://ayin.stream",
});

document.hidden = true;
document.dispatch("visibilitychange");
assert.deepEqual(posted.at(-1)?.payload, {
  source: "ayin-tizen-shell",
  type: "lifecycle",
  state: "pause",
});

navigator.onLine = false;
window.dispatch("offline");
assert.deepEqual(posted.at(-1)?.payload, {
  source: "ayin-tizen-shell",
  type: "network",
  online: false,
});

window.dispatch("message", {
  origin: "https://ayin.stream",
  source: contentWindow,
  data: { source: "ayin-tizen-app", type: "exit-request" },
});
assert.equal(elements["exit-dialog"].hidden, false);
assert.equal(elements["exit-no"].dataset.selected, "true");

window.dispatch("keydown", {
  keyCode: 39,
  preventDefault() {},
});
assert.equal(elements["exit-yes"].dataset.selected, "true");

window.dispatch("keydown", {
  keyCode: 13,
  preventDefault() {},
});
assert.equal(exited, true);

const previousPosts = posted.length;
window.dispatch("keydown", {
  keyCode: 10182,
  preventDefault() {
    throw new Error("Exit key must retain Samsung default behavior");
  },
});
assert.equal(posted.length, previousPosts);

console.log("Tizen packaged shell adapter tests passed.");
