;(() => {
  const saved = localStorage.getItem("disklizard-color-scheme")
  const dark =
    saved === "dark" ||
    (saved !== "light" && matchMedia("(prefers-color-scheme: dark)").matches)
  document.documentElement.style.colorScheme = dark ? "dark" : "light"
  document.documentElement.dataset.colorScheme = dark ? "dark" : "light"
  document.documentElement.classList.toggle("dark", dark)
})()
