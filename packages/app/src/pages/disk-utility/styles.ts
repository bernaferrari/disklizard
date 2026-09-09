import { MAC_TRAFFIC_LIGHT_INSET, WINDOWS_CAPTION_BUTTONS_INSET } from "./titlebar"

/**
 * Residual DiskLizard stylesheet.
 *
 * Everything component-shaped now lives in Tailwind utilities at call sites
 * (mapping in .v1-reference/TAILWIND.md) and animation runs on framer-motion
 * (./motion-ui.tsx) or the shadcn/base-ui dialog + sheet primitives. What
 * remains here: shell-scoped design tokens (hoisted to :root so portaled
 * shadcn surfaces resolve them), the dark token overrides, native-titlebar
 * drag rules, narrow-chrome responsive hides, container-scoped text sizing,
 * and the scan-progress bar animation that needs a ::after gradient.
 */
export const DISK_UTILITY_STYLES = `
:root {
  --dl-accent: oklch(0.72 0.035 275);
  --dl-accent-strong: oklch(0.65 0.045 275);
  --dl-scrim: rgb(0 0 0 / 0.58);
  --dl-hairline: 1px;
  --text-weak: color-mix(in oklch, var(--text-strong) 72%, var(--background-base));
  --text-weaker: color-mix(in oklch, var(--text-strong) 58%, var(--background-base));
  --color-text-weak: var(--text-weak);
  --color-text-weaker: var(--text-weaker);
}

/* Neutral desktop surfaces shared by the inspector, controls, and review dock. */
:root[data-color-scheme="dark"] {
  --dl-chrome: oklch(0.22 0.006 260);
  --background-base: oklch(0.245 0.006 260);
  --surface-raised-base: oklch(0.265 0.007 260);
  --surface-raised-strong: oklch(0.315 0.009 260);
  --surface-base-hover: oklch(0.27 0.01 285);
  --surface-base-active: oklch(0.3 0.01 285);
  --button-secondary-base: oklch(0.27 0.01 285);
  --button-secondary-hover: oklch(0.31 0.01 285);
  --border-weaker-base: oklch(0.32 0.007 260);
  --border-weak-base: oklch(0.35 0.008 285);
  --text-strong: oklch(0.94 0.005 285);
  --text-base: oklch(0.87 0.006 285);
  --icon-base: oklch(0.72 0.008 285);
  --icon-weak: oklch(0.65 0.008 285);
  --text-weak: color-mix(in oklch, var(--text-strong) 72%, var(--background-base));
  --color-background-base: var(--background-base);
  --color-surface-raised-base: var(--surface-raised-base);
  --color-surface-raised-strong: var(--surface-raised-strong);
  --color-border-weaker-base: var(--border-weaker-base);
  --color-border-weak-base: var(--border-weak-base);
  --color-text-strong: var(--text-strong);
  --color-text-base: var(--text-base);
  --color-text-weak: var(--text-weak);
  --color-text-weaker: var(--text-weaker);
  --text-weaker: color-mix(in oklch, var(--text-strong) 58%, var(--background-base));
}

.dl-shell {
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  font-synthesis: none;
  font-variant-numeric: tabular-nums;
  background: var(--background-base);
}
.dl-shell button, .dl-shell a, .dl-shell input, .dl-shell select, .dl-shell summary { touch-action: manipulation; }
.dl-shell ::selection { background: oklch(0.74 0.13 252 / 0.22); }

/* Native titlebar: the bar drags the window; interactive children opt out. */
.dl-topbar {
  background: var(--dl-chrome, var(--background-base));
  box-shadow: 0 1px 0 rgb(127 127 127 / 0.1);
  -webkit-app-region: drag;
  app-region: drag;
}
.dl-topbar button,
.dl-topbar a,
.dl-topbar input,
.dl-topbar [role="button"] {
  -webkit-app-region: no-drag;
  app-region: no-drag;
}
.dl-shell[data-os="macos"]:not([data-fullscreen="true"]) .dl-topbar {
  padding-left: ${MAC_TRAFFIC_LIGHT_INSET}px;
}
.dl-shell[data-os="windows"]:not([data-fullscreen="true"]) .dl-topbar {
  width: env(titlebar-area-width, calc(100vw - ${WINDOWS_CAPTION_BUTTONS_INSET}px));
  max-width: env(titlebar-area-width, calc(100vw - ${WINDOWS_CAPTION_BUTTONS_INSET}px));
  margin-right: auto;
}

.dl-search-input::-webkit-search-cancel-button { -webkit-appearance: none; }

/* Storage list rows bump the primary label to the denser UI size. */
.dl-index-row .text-13-semibold { font-size: 14px; font-weight: 500; }

/* Narrow chrome: hide breadcrumbs, tighten the tiles overlay. */
@media (max-width: 760px) {
  .dl-breadcrumbs { display: none; }
  .dl-treemap-overlay { padding-top: 16px; }
}

/* Idle command dock collapses its cleanup affordances. */
.dl-command-dock-idle { display: none; }
.dl-command-dock-idle .dl-command-dock-inner > div:first-child { visibility: hidden; }
.dl-command-dock-idle .min-h-11 { min-height: 32px; }

/* Volume bar: settle flash after a scan lands, travelling stripes while scanning. */
.dl-volume-bar-fill[data-settled] { animation: dl-volume-settle 420ms cubic-bezier(0.32, 0.72, 0, 1) 1; }
@keyframes dl-volume-settle {
  from { filter: brightness(1.35); }
  to { filter: brightness(1); }
}
.dl-volume-bar-fill[data-scanning] { position: relative; overflow: hidden; background: transparent; }
.dl-volume-bar-fill[data-scanning]::after {
  content: "";
  position: absolute;
  inset: 0 -18px 0 0;
  /* One continuous gradient, not separately tiled images. At 115 degrees,
     two 8px stripe periods travel 16 / sin(115deg) pixels horizontally. */
  background-image: repeating-linear-gradient(115deg,
    var(--dl-volume-ink) 0 5px,
    color-mix(in oklch, var(--dl-volume-ink) 78%, white) 5px 8px);
  animation: dl-scan-travel 700ms linear infinite;
  will-change: transform;
}
@keyframes dl-scan-travel {
  from { transform: translateX(-17.654047px); }
  to { transform: translateX(0); }
}
@media (prefers-reduced-motion: reduce) {
  .dl-volume-bar-fill[data-scanning]::after { animation: none; transform: none; will-change: auto; }
  .dl-volume-bar-fill { animation: none !important; transition: none !important; }
}

/* View transitions (morph between map/tiles/layers snapshots). */
::view-transition-old(root), ::view-transition-new(root) { animation: none; }
::view-transition-group(disk-landscape) { animation-duration: 220ms; }
::view-transition-old(disk-landscape) { animation: dl-view-out 160ms ease-out both; }
::view-transition-new(disk-landscape) { animation: dl-view-in 220ms cubic-bezier(.22, 1, .36, 1) both; }
@keyframes dl-view-out { to { opacity: 0; transform: scale(.985); } }
@keyframes dl-view-in { from { opacity: 0; transform: scale(.985); } }

@media only screen and (min-device-pixel-ratio: 2), only screen and (min-resolution: 192dpi) {
  :root { --dl-hairline: 0.5px; }
}

@media (prefers-reduced-motion: reduce) {
  ::view-transition-group(*), ::view-transition-old(*), ::view-transition-new(*) { animation: none !important; }
  .dl-shell * { animation: none !important; transition: none !important; scroll-behavior: auto !important; }
}
`
