"use strict";

(function () {
  var AYIN_ORIGIN = "https://ayin.stream";
  var APP_SOURCE = "ayin-tizen-app";
  var SHELL_SOURCE = "ayin-tizen-shell";
  var EXIT_KEY = 10182;

  var REMOTE_BY_CODE = {
    13: "SELECT",
    37: "LEFT",
    38: "UP",
    39: "RIGHT",
    40: "DOWN",
    10009: "BACK",
    10252: "PLAY_PAUSE",
    412: "REWIND",
    19: "PAUSE",
    415: "PLAY",
    417: "FAST_FORWARD",
  };

  var MEDIA_KEYS = [
    "MediaPlayPause",
    "MediaPlay",
    "MediaPause",
    "MediaRewind",
    "MediaFastForward",
  ];

  var frame = document.getElementById("ayin-app");
  var loading = document.getElementById("loading");
  var dialog = document.getElementById("exit-dialog");
  var noButton = document.getElementById("exit-no");
  var yesButton = document.getElementById("exit-yes");
  var selectedExit = "no";
  var appReady = false;

  function registerRemoteKeys() {
    try {
      if (!window.tizen || !tizen.tvinputdevice) return;
      if (typeof tizen.tvinputdevice.registerKeyBatch === "function") {
        tizen.tvinputdevice.registerKeyBatch(MEDIA_KEYS);
        return;
      }
      MEDIA_KEYS.forEach(function (key) {
        tizen.tvinputdevice.registerKey(key);
      });
    } catch (error) {
      console.warn("AYIN Tizen media-key registration failed", error);
    }
  }

  function postToApp(payload) {
    if (!frame || !frame.contentWindow) return;
    frame.contentWindow.postMessage(payload, AYIN_ORIGIN);
  }

  function sendRemote(key) {
    postToApp({ source: SHELL_SOURCE, type: "remote", key: key });
  }

  function sendLifecycle() {
    postToApp({
      source: SHELL_SOURCE,
      type: "lifecycle",
      state: document.hidden ? "pause" : "resume",
    });
  }

  function sendNetwork() {
    postToApp({
      source: SHELL_SOURCE,
      type: "network",
      online: navigator.onLine !== false,
    });
  }

  function renderExitSelection() {
    noButton.dataset.selected = selectedExit === "no" ? "true" : "false";
    yesButton.dataset.selected = selectedExit === "yes" ? "true" : "false";
  }

  function showExitDialog() {
    dialog.hidden = false;
    selectedExit = "no";
    renderExitSelection();
    document.body.focus();
  }

  function hideExitDialog() {
    dialog.hidden = true;
    selectedExit = "no";
    renderExitSelection();
  }

  function exitApplication() {
    try {
      if (
        window.tizen &&
        tizen.application &&
        typeof tizen.application.getCurrentApplication === "function"
      ) {
        tizen.application.getCurrentApplication().exit();
      }
    } catch (error) {
      console.warn("AYIN Tizen exit failed", error);
    }
  }

  function handleDialogKey(code) {
    if (code === EXIT_KEY) return false;
    if (code === 37 || code === 39) {
      selectedExit = selectedExit === "no" ? "yes" : "no";
      renderExitSelection();
      return true;
    }
    if (code === 13) {
      if (selectedExit === "yes") exitApplication();
      else hideExitDialog();
      return true;
    }
    if (code === 10009) {
      hideExitDialog();
      return true;
    }
    return true;
  }

  function onKeyDown(event) {
    var code = event.keyCode || event.which;

    // Samsung requires long-press Exit to retain the platform default behavior.
    if (code === EXIT_KEY) return;

    if (!dialog.hidden) {
      if (handleDialogKey(code)) event.preventDefault();
      return;
    }

    var key = REMOTE_BY_CODE[code];
    if (!key) return;
    event.preventDefault();
    sendRemote(key);
  }

  function onAppMessage(event) {
    if (event.origin !== AYIN_ORIGIN || event.source !== frame.contentWindow) return;
    var data = event.data;
    if (!data || data.source !== APP_SOURCE) return;

    if (data.type === "ready") {
      appReady = true;
      loading.hidden = true;
      sendLifecycle();
      sendNetwork();
      return;
    }

    if (data.type === "exit-request") {
      showExitDialog();
    }
  }

  function onFrameLoad() {
    if (!appReady) {
      window.setTimeout(function () {
        if (!appReady) loading.textContent = "AYIN is still loading…";
      }, 8000);
    }
  }

  noButton.addEventListener("click", hideExitDialog);
  yesButton.addEventListener("click", exitApplication);
  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("message", onAppMessage);
  window.addEventListener("online", sendNetwork);
  window.addEventListener("offline", sendNetwork);
  document.addEventListener("visibilitychange", sendLifecycle);
  frame.addEventListener("load", onFrameLoad);

  registerRemoteKeys();
  document.body.focus();
})();
