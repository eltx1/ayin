(() => {
  "use strict";

  const TARGET_URL = "https://ayin.stream/?platform=webos&hosted=1";
  let waitingForNetwork = false;

  function status(message) {
    const node = document.getElementById("status");
    if (node) node.textContent = message;
  }

  function openHostedAyin() {
    waitingForNetwork = false;
    status("Opening AYIN…");
    window.location.replace(TARGET_URL);
  }

  function waitForNetwork() {
    if (waitingForNetwork) return;
    waitingForNetwork = true;
    status("Connect this TV to the internet to open AYIN.");
    window.addEventListener(
      "online",
      () => {
        if (!waitingForNetwork) return;
        openHostedAyin();
      },
      { once: true },
    );
  }

  function start() {
    if (window.navigator.onLine === false) {
      waitForNetwork();
      return;
    }
    openHostedAyin();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
