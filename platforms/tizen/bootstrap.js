(() => {
  "use strict";

  const target = "https://ayin.stream/?platform=tizen";
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

  window.addEventListener("online", redirect);
  window.addEventListener("offline", renderOffline);
  redirect();
})();
