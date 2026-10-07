(() => {
  try {
    const savedTheme = window.localStorage.getItem("nest-theme");
    let theme = savedTheme;
    if (theme !== "light" && theme !== "dark") {
      theme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    document.documentElement.dataset.theme = theme;
  } catch {
    document.documentElement.dataset.theme = "light";
  }
  try {
    // Privacy mode hides balances before first paint so amounts never flash on screen.
    if (window.localStorage.getItem("nest-privacy-mode") === "on") document.documentElement.dataset.privacy = "on";
  } catch { /* Storage is optional. */ }
})();
