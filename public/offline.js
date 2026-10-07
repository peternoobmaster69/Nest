const { renderStaticPageCopy, staticPageText } = globalThis.NestStaticPage;

renderStaticPageCopy(document);

(() => {
  const connectionStatus = document.getElementById("status");
  const retry = document.getElementById("retry");
  const back = document.getElementById("back");

  const returnToApp = () => {
    if (window.location.pathname === "/offline.html") window.location.assign(new URL("/", window.location.href).href);
    else window.location.reload();
  };

  const reconnect = () => {
    connectionStatus.textContent = staticPageText("offline.connectionRestored");
    returnToApp();
  };

  retry.addEventListener("click", () => {
    connectionStatus.textContent = staticPageText(navigator.onLine ? "offline.checkingConnection" : "offline.stillOffline");
    returnToApp();
  });

  back.addEventListener("click", () => {
    if (window.history.length > 1) window.history.back();
    else connectionStatus.textContent = staticPageText("offline.noHistory");
  });

  window.addEventListener("online", reconnect);
  if (navigator.onLine) {
    // An online device can still be unable to reach Nest. Wait for an explicit
    // retry or a new connection event instead of reloading the fallback in a loop.
    connectionStatus.textContent = staticPageText("offline.connectionAvailable");
  }
})();
