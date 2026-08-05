(() => {
  try {
    const saved = localStorage.getItem("dy_theme") || "auto";
    const prefersLight =
      window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: light)").matches;
    if (saved === "light" || (saved === "auto" && prefersLight)) {
      document.documentElement.dataset.theme = "light";
    }
  } catch {}
})();
