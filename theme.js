"use strict";

(() => {
  const preference = window.matchMedia("(prefers-color-scheme: dark)");
  let savedTheme;
  try {
    savedTheme = localStorage.getItem("iseebtc-theme");
  } catch {
    // The toggle also works when browser storage is unavailable.
  }
  let explicitTheme = savedTheme === "light" || savedTheme === "dark";

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    const button = document.querySelector(".theme-toggle");
    if (button) {
      button.hidden = false;
      button.textContent = theme === "dark" ? "Light theme" : "Dark theme";
      button.setAttribute("aria-label", theme === "dark" ? "Switch to light theme" : "Switch to dark theme");
    }
    window.dispatchEvent(new CustomEvent("themechange", {detail: {theme}}));
  }

  applyTheme(explicitTheme ? savedTheme : preference.matches ? "dark" : "light");
  document.addEventListener("DOMContentLoaded", () => {
    applyTheme(document.documentElement.dataset.theme);
    document.querySelector(".theme-toggle").addEventListener("click", () => {
      const theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
      explicitTheme = true;
      try {
        localStorage.setItem("iseebtc-theme", theme);
      } catch {
        // Keep the selected theme for the current page.
      }
      applyTheme(theme);
    });
  });
  preference.addEventListener("change", () => {
    if (!explicitTheme) applyTheme(preference.matches ? "dark" : "light");
  });
})();
