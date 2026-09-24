(function () {
  "use strict";

  var TARGET_URL = "https://ayin.stream/?platform=tizen&hosted=1";
  var MEDIA_KEYS = [
    "MediaPlayPause",
    "MediaPlay",
    "MediaPause",
    "MediaRewind",
    "MediaFastForward"
  ];
  var redirected = false;

  function navigationType() {
    try {
      var entries = window.performance && window.performance.getEntriesByType
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

  function goToHostedApp() {
    if (redirected) return;
    redirected = true;
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
          }
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

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", registerMediaKeysThenLaunch, { once: true });
  } else {
    registerMediaKeysThenLaunch();
  }
})();
