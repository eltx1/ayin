(() => {
  "use strict";

  const target = "https://ayin.stream/?platform=tizen";
  const mediaKeys = [
    "MediaPlayPause",
    "MediaPlay",
    "MediaPause",
    "MediaRewind",
    "MediaFastForward",
  ];
  let redirected = false;
  let timeoutId = 0;

  function redirect() {
    if (redirected) return;
    redirected = true;
    if (timeoutId) window.clearTimeout(timeoutId);
    window.location.replace(target);
  }

  try {
    const input = window.tizen && window.tizen.tvinputdevice;
    if (input && typeof input.registerKeyBatch === "function") {
      timeoutId = window.setTimeout(redirect, 750);
      input.registerKeyBatch(mediaKeys, redirect, redirect);
      return;
    }
    if (input && typeof input.registerKey === "function") {
      for (const key of mediaKeys) input.registerKey(key);
    }
  } catch {
    // Optional key registration failure must not block AYIN from opening.
  }

  redirect();
})();
