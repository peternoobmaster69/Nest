(() => {
  const connectionStatus = document.getElementById("status");
  const retry = document.getElementById("retry");
  const back = document.getElementById("back");

  const returnToApp = () => {
    if (window.location.pathname === "/offline.html") window.location.assign(new URL("/", window.location.href).href);
    else window.location.reload();
  };

  const reconnect = () => {
    connectionStatus.textContent = "Connection restored. Reloading…";
    returnToApp();
  };

  retry.addEventListener("click", () => {
    connectionStatus.textContent = navigator.onLine ? "Checking connection…" : "Still offline. We’ll retry when you reconnect.";
    returnToApp();
  });

  back.addEventListener("click", () => {
    if (window.history.length > 1) window.history.back();
    else connectionStatus.textContent = "No earlier screen is available in this window.";
  });

  window.addEventListener("online", reconnect);
  if (navigator.onLine) {
    if (window.location.pathname === "/offline.html") {
      connectionStatus.textContent = "Connection available. Try again to return to Nest.";
    } else {
      reconnect();
    }
  }
})();
