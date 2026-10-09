import {
  MAC_TRAFFIC_LIGHT_INSET,
  WINDOWS_CAPTION_BUTTONS_INSET,
} from "./titlebar"

/**
 * Residual DiskLizard stylesheet.
 *
 * Everything component-shaped now lives in Tailwind utilities at call sites
 * (mapping in .v1-reference/TAILWIND.md) and animation runs on framer-motion
 * (./motion-ui.tsx) or the shadcn/base-ui dialog + sheet primitives. What
 * remains here: shell-scoped design tokens (hoisted to :root so portaled
 * shadcn surfaces resolve them), the dark token overrides, native-titlebar
 * drag rules, narrow-chrome responsive hides, container-scoped text sizing,
 * and the scan progress bar's settled state.
 */
export const DISK_UTILITY_STYLES = `
:root {
  /* shadcn semantic roles inherit the desktop surface palette. */
  --background: var(--background-base);
  --foreground: var(--text-strong);
  --popover: var(--dl-popover);
  --popover-foreground: var(--text-strong);
  --secondary: var(--dl-well);
  --secondary-foreground: var(--text-strong);
  --accent: var(--dl-well-strong);
  --accent-foreground: var(--text-strong);
  --border: var(--dl-separator);
  --destructive: var(--dl-danger-action);

  --dl-accent: oklch(0.6 0.19 256);
  /* Filled actions have their own contrast-safe ramp in both themes. */
  --dl-action: oklch(0.54 0.17 256);
  --dl-action-hover: oklch(0.51 0.17 256);
  --dl-danger-action: oklch(0.55 0.2 27);
  --dl-danger-action-hover: oklch(0.52 0.2 27);
  --dl-accent-strong: oklch(0.55 0.2 256);
  /* System-style focus: the accent blue, never a hard black/white outline. */
  --dl-focus: color-mix(in oklab, var(--dl-accent) 80%, transparent);
  --dl-well: rgb(120 120 128 / 0.12);
  --dl-well-strong: rgb(120 120 128 / 0.2);
  --dl-raised: #ffffff;
  --dl-popover: #ffffff;
  --dl-separator: rgb(0 0 0 / 0.08);
  --dl-row-hover: rgb(120 120 128 / 0.08);
  --dl-positive: oklch(0.56 0.15 150);
  --dl-positive-soft: oklch(0.72 0.16 150 / 0.16);
  --dl-scan-pending: oklch(0.62 0.045 230);
  --dl-scan-tint: oklch(0.57 0.02 230);
  --dl-warning: oklch(0.7 0.16 70);
  --dl-danger: oklch(0.58 0.2 27);
  --dl-sidebar: var(--background-base);
  --dl-tile-shell-mix: 24%;
  --dl-tile-fill-mix: 58%;
  --dl-tile-summary-mix: 50%;
  --dl-tile-hover: oklch(1 0 0 / 0.10);
  /* Summary cells fade toward this neutral so they read as "the rest". */
  --dl-aggregate-neutral: oklch(0.9 0.008 255);
  --dl-scrim: rgb(0 0 0 / 0.58);
  --dl-hairline: 1px;
  --text-weak: color-mix(in oklch, var(--text-strong) 72%, var(--background-base));
  --text-weaker: color-mix(in oklch, var(--text-strong) 58%, var(--background-base));
  --color-text-weak: var(--text-weak);
  --color-text-weaker: var(--text-weaker);
}

/* Neutral desktop surfaces shared by the inspector, controls, and review dock. */
:root[data-color-scheme="dark"] {
  --background: var(--background-base);
  --foreground: var(--text-strong);
  --popover: var(--dl-popover);
  --popover-foreground: var(--text-strong);
  --secondary: var(--dl-well);
  --secondary-foreground: var(--text-strong);
  --accent: var(--dl-well-strong);
  --accent-foreground: var(--text-strong);
  --border: var(--dl-separator);
  --destructive: var(--dl-danger);

  --dl-tile-shell-mix: 20%;
  --dl-tile-fill-mix: 34%;
  --dl-tile-summary-mix: 30%;
  --dl-tile-hover: oklch(1 0 0 / 0.04);
  --dl-aggregate-neutral: oklch(0.42 0.008 270);
  --dl-accent: oklch(0.64 0.17 256);
  --dl-danger: oklch(0.72 0.16 27);
  --text-weaker: color-mix(in oklch, var(--text-strong) 62%, var(--background-base));
  --dl-raised: oklch(0.41 0.009 270);
  --dl-popover: oklch(0.3 0.009 270);
  --dl-separator: rgb(255 255 255 / 0.07);
  --dl-well: rgb(255 255 255 / 0.06);
  --dl-well-strong: rgb(255 255 255 / 0.11);
  --dl-row-hover: rgb(255 255 255 / 0.05);
  --dl-positive: oklch(0.82 0.15 152);
  --dl-positive-soft: oklch(0.78 0.16 152 / 0.14);
  --dl-scan-tint: oklch(0.4 0.02 230);
  --dl-warning: oklch(0.82 0.14 80);
  --dl-chrome: oklch(0.235 0.008 270);
  --background-base: oklch(0.262 0.008 270);
  --surface-raised-base: oklch(0.29 0.008 270);
  --surface-raised-strong: oklch(0.335 0.009 270);
  --surface-base-hover: oklch(0.27 0.01 285);
  --surface-base-active: oklch(0.3 0.01 285);
  --button-secondary-base: oklch(0.27 0.01 285);
  --button-secondary-hover: oklch(0.31 0.01 285);
  --border-weaker-base: oklch(0.335 0.008 270);
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

/* Native UI type on each platform: SF on macOS, Segoe UI Variable on Windows. */
:root[data-dl-os="macos"] {
  --font-family-sans: -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif;
}
:root[data-dl-os="windows"] {
  --font-family-sans: "Segoe UI Variable Text", "Segoe UI Variable", "Segoe UI", system-ui, sans-serif;
}
:root[data-dl-os] body { font-family: var(--font-family-sans); }

.dl-shell {
  font-family: var(--font-family-sans);
  letter-spacing: -0.003em;
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

/* Shapes land first; labels then resolve without crossing the flying geometry. */
.dl-treemap-overlay .dl-treemap-text { opacity: 0; }
.dl-treemap-overlay .dl-treemap-chrome { opacity: 0; }
.dl-treemap-overlay[data-labels-visible="true"] .dl-treemap-text {
  opacity: 1;
  transition: opacity 130ms ease-out;
}
.dl-treemap-overlay[data-labels-visible="true"] .dl-treemap-chrome {
  opacity: 1;
  transition: opacity 130ms ease-out;
}
/* Camera contents already own the reveal. A second label fade left the
   travelling branch anonymous and delayed its names after landing. */

/* Preserve the current location even on narrow windows. */
@media (max-width: 760px) {
  .dl-breadcrumbs { min-width: 70px; }
  .dl-treemap-overlay { padding-top: 48px; }
}

/* Keep the map's footprint fixed when selection reveals the command dock. */
.dl-command-dock-idle { border-top-color: transparent; }
.dl-command-dock-idle .dl-command-dock-inner { visibility: hidden; }

/* Completed scan progress stays bright against a quiet unfilled track. */
.dl-volume-bar-fill[data-settled] { animation: dl-volume-settle 420ms cubic-bezier(0.32, 0.72, 0, 1) 1; }
@keyframes dl-volume-settle {
  from { filter: brightness(1.35); }
  to { filter: brightness(1); }
}
/* Scanning: the accent with a slow sheen, so progress reads as alive even
   when the percentage is holding still on a large folder. */
.dl-volume-bar-fill[data-scanning] {
  background: linear-gradient(90deg, var(--dl-accent) 0%, color-mix(in oklab, var(--dl-accent) 55%, white) 50%, var(--dl-accent) 100%);
  background-size: 200% 100%;
  animation: dl-scan-sheen 1.6s linear infinite;
}
@keyframes dl-scan-sheen { from { background-position: 100% 0; } to { background-position: -100% 0; } }
@media (prefers-reduced-motion: reduce) {
  .dl-volume-bar-fill { animation: none !important; transition: none !important; }
}

/* Tile camera: labels never ride a zoom (they would balloon or squash);
   they step aside while the camera moves and settle back once it lands. */
.dl-treemap .dl-treemap-text { transition: opacity 180ms ease-out; }
.dl-treemap[data-tile-camera-moving] .dl-treemap-text { opacity: 0; transition: opacity 80ms ease-out; }

/* View transitions (morph between map and tiles snapshots). */
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
