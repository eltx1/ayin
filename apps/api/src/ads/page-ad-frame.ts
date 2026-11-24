/**
 * Wraps a pasted ad tag in a minimal document. The resize script reports the rendered height to
 * the embedding AYIN page (which only trusts messages from this exact frame window), links open
 * in a new tab, and an empty or disabled slot renders nothing so the page collapses it.
 */
export function renderPageAdFrame(code: string | null): string {
  const body = code ?? "";
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="strict-origin-when-cross-origin">
<base target="_blank">
<style>html,body{margin:0;padding:0;background:transparent;overflow:hidden}body{display:flex;justify-content:center;align-items:flex-start}</style>
</head>
<body>
<div id="ayin-ad-root">${body}</div>
<script>
(function () {
  var last = -1;
  function report() {
    var root = document.getElementById("ayin-ad-root");
    var height = root ? Math.ceil(root.getBoundingClientRect().height) : 0;
    if (height === last) return;
    last = height;
    try { parent.postMessage({ type: "ayin-ad-frame-size", height: height }, "*"); } catch (e) {}
  }
  if (typeof ResizeObserver === "function") {
    var observer = new ResizeObserver(report);
    var root = document.getElementById("ayin-ad-root");
    if (root) observer.observe(root);
  }
  window.addEventListener("load", report);
  setInterval(report, 1000);
  report();
})();
</script>
</body>
</html>`;
}
