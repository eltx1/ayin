(() => {
  "use strict";

  var MIN_TIZEN_VERSION = 9;
  var TARGET = "https://ayin.stream/?platform=tizen&ayin_tizen_hosted=1";
  var status = document.getElementById("status");
  var launched = false;

  function tizenVersion(userAgent) {
    var match = /\bTizen\s+(\d+(?:\.\d+)?)/i.exec(userAgent || "");
    if (!match || !match[1]) return null;
    var value = Number(match[1]);
    return Number.isFinite(value) ? value : null;
  }

  function setStatus(message) {
    if (status) status.textContent = message;
  }

  function launch() {
    if (launched) return;
    var version = tizenVersion(navigator.userAgent);
    if (version === null) {
      setStatus("AYIN could not identify this Samsung TV runtime.");
      return;
    }
    if (version < MIN_TIZEN_VERSION) {
      setStatus("This Samsung TV version is not in the AYIN supported baseline.");
      return;
    }
    if (navigator.onLine === false) {
      setStatus("Waiting for a network connection…");
      window.addEventListener("online", launch, { once: true });
      return;
    }

    launched = true;
    setStatus("Opening AYIN…");
    window.location.replace(TARGET);
  }

  launch();
})();
