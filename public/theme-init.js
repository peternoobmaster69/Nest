(() => {
  try {
    const savedTheme = window.localStorage.getItem("nest-theme");
    const theme =
      savedTheme === "light" || savedTheme === "dark"
        ? savedTheme
        : window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light";
    document.documentElement.setAttribute("data-theme", theme);
  } catch {
    document.documentElement.setAttribute("data-theme", "light");
  }
  try {
    // Privacy mode hides balances before first paint so amounts never flash on screen.
    if (window.localStorage.getItem("nest-privacy-mode") === "on") document.documentElement.dataset.privacy = "on";
  } catch { /* Storage is optional. */ }
})();
