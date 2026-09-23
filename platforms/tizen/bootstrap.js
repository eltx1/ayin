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
  const status = document.getElementById("tizen-bootstrap-status");
  let navigating = false;

  const renderOffline = () => {
    if (status) status.textContent = "AYIN needs an internet connection. Reconnecting…";
  };

  const redirect = () => {
    if (navigating) return;
    if (!navigator.onLine) {
      renderOffline();
      return;
    }
    navigating = true;
    window.location.replace(target);
  };

  const registerLocalMediaKeys = () => {
    try {
      const input = window.tizen && window.tizen.tvinputdevice;
      if (!input) return;
      if (typeof input.registerKeyBatch === "function") {
        input.registerKeyBatch(mediaKeys);
        return;
      }
      if (typeof input.registerKey === "function") {
        for (const key of mediaKeys) input.registerKey(key);
      }
    } catch {
      // Hosted content cannot rely on Tizen APIs; registration is best-effort only.
    }
  };

  window.addEventListener("online", redirect);
  window.addEventListener("offline", renderOffline);
  registerLocalMediaKeys();
  redirect();
})();
