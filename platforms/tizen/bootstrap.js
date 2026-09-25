(function () {
  "use strict";

  var TARGET_URL = "https://ayin.stream/?platform=tizen&hosted=1";
  var MEDIA_KEYS = ["MediaPlayPause", "MediaPlay", "MediaPause", "MediaRewind", "MediaFastForward"];
  var redirected = false;
  var waitingForOnline = false;

  function navigationType() {
    try {
      var entries =
        window.performance && window.performance.getEntriesByType
          ? window.performance.getEntriesByType("navigation")
          : [];
      return entries && entries[0] ? entries[0].type : null;
    } catch (_) {
      return null;
    }
  }

  function exitPackagedShell() {
    try {
      if (window.tizen && window.tizen.application) {
        window.tizen.application.getCurrentApplication().exit();
        return true;
      }
    } catch (_) {
      // Fall through to hosted navigation if the platform refuses the exit call.
    }
    return false;
  }

  function setStatus(message) {
    var status = document.getElementById ? document.getElementById("status") : null;
    if (status) status.textContent = message;
  }

  function goToHostedApp() {
    if (redirected) return;

    if (window.navigator && window.navigator.onLine === false) {
      setStatus("Network connection lost. Reconnect to continue.");
      if (!waitingForOnline) {
        waitingForOnline = true;
        window.addEventListener(
          "online",
          function () {
            waitingForOnline = false;
            setStatus("Opening AYIN…");
            goToHostedApp();
          },
          { once: true },
        );
      }
      return;
    }

    redirected = true;
    setStatus("Opening AYIN…");
    window.location.assign(TARGET_URL);
  }

  function registerMediaKeysThenLaunch() {
    if (navigationType() === "back_forward" && exitPackagedShell()) {
      return;
    }

    var input = window.tizen && window.tizen.tvinputdevice;
    if (!input) {
      goToHostedApp();
      return;
    }

    try {
      var supported = input.getSupportedKeys ? input.getSupportedKeys() : [];
      var supportedNames = {};
      for (var index = 0; index < supported.length; index += 1) {
        if (supported[index] && supported[index].name) {
          supportedNames[supported[index].name] = true;
        }
      }

      var keys = MEDIA_KEYS.filter(function (key) {
        return supported.length === 0 || supportedNames[key] === true;
      });

      if (keys.length === 0) {
        goToHostedApp();
        return;
      }

      if (input.registerKeyBatch) {
        var timeout = window.setTimeout(goToHostedApp, 750);
        input.registerKeyBatch(
          keys,
          function () {
            window.clearTimeout(timeout);
            goToHostedApp();
          },
          function () {
            window.clearTimeout(timeout);
            goToHostedApp();
          },
        );
        return;
      }

      for (var keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
        try {
          input.registerKey(keys[keyIndex]);
        } catch (_) {
          // Unsupported optional keys are non-fatal.
        }
      }
    } catch (_) {
      // Hosted content must still start if key registration is unavailable.
    }

    goToHostedApp();
  }

  function onPageShow(event) {
    if (!event || event.persisted !== true) return;
    if (exitPackagedShell()) return;

    // If a non-Tizen test/browser restores this page from BFCache, fail open back to
    // the canonical hosted product instead of leaving the user on the bootstrap page.
    redirected = false;
    registerMediaKeysThenLaunch();
  }

  window.addEventListener("pageshow", onPageShow);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", registerMediaKeysThenLaunch, { once: true });
  } else {
    registerMediaKeysThenLaunch();
  }
})();
