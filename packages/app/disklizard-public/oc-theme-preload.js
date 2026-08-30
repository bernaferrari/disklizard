;(function () {
  var isDark = matchMedia("(prefers-color-scheme: dark)").matches
  var mode = isDark ? "dark" : "light"

  document.documentElement.dataset.theme = "oc-2"
  document.documentElement.dataset.colorScheme = mode
  document.documentElement.style.backgroundColor = isDark ? "#080808" : "#fafafa"

  var metas = document.querySelectorAll("meta[name='theme-color']")
  if (metas.length > 0) metas[0].setAttribute("content", isDark ? "#080808" : "#fafafa")

})()
