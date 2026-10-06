function setStyleGuideTheme(theme) {
  document.documentElement.dataset.theme = theme;
  for (const button of document.querySelectorAll("[data-theme-option]")) {
    const active = button.dataset.themeOption === theme;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }
}

for (const button of document.querySelectorAll("[data-theme-option]")) {
  button.addEventListener("click", () => setStyleGuideTheme(button.dataset.themeOption));
}
setStyleGuideTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
