import { MAC_TRAFFIC_LIGHT_INSET, WINDOWS_CAPTION_BUTTONS_INSET } from "./titlebar"

export const DISK_UTILITY_STYLES = `
.dl-shell {
  --dl-accent: oklch(0.72 0.035 275);
  --dl-accent-strong: oklch(0.65 0.045 275);
  --dl-scrim: rgb(0 0 0 / 0.58);
  --dl-hairline: 1px;
  --text-weak: color-mix(in oklch, var(--text-strong) 72%, var(--background-base));
  --text-weaker: color-mix(in oklch, var(--text-strong) 58%, var(--background-base));
  --color-text-weak: var(--text-weak);
  --color-text-weaker: var(--text-weaker);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  font-synthesis: none;
  font-variant-numeric: tabular-nums;
  background: var(--background-base);
}
.dl-workspace-frame {
  width: calc(100% - 24px);
  max-width: 1320px;
  margin-inline: auto;
  border: 1px solid var(--border-weaker-base);
  background: var(--background-base);
  box-shadow: 0 2px 8px rgb(0 0 0 / 0.08);
}
.dl-landscape { container-type: size; background: var(--background-base); padding-bottom: 64px; }
.dl-map-stage { width: min(100cqw, calc(100cqh - 64px), 820px); height: min(100cqw, calc(100cqh - 64px), 820px); }
.dl-inspector { container-type: inline-size; background: var(--surface-raised-base); }
/* Filters can grow, but must never consume the results viewport. */
.dl-inspector-header {
  max-height: max(100px, calc(100% - 224px));
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
  padding: 16px;
}
.dl-inspector-header .dl-lens-section { margin-top: 10px; }
.dl-inspector-header > div:first-child > div:first-child { display: flex; flex-direction: row-reverse; align-items: center; justify-content: space-between; gap: 12px; }
.dl-entry-tag, .dl-entry-path, .dl-entry-age { display: none; }
.dl-entry-path-visible { display: inline; }
@container (min-width: 600px) {
  .dl-entry-tag, .dl-entry-path, .dl-entry-age { display: inline; }
}
.dl-detail-bar { container-type: inline-size; }
.dl-detail-actions-wide { display: none; }
@container (min-width: 900px) {
  .dl-detail-actions-wide { display: flex; }
  .dl-detail-actions-compact { display: none; }
}
.dl-volume-snapshots { background: transparent; padding-top: 0; padding-bottom: 0; }
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
.dl-shell button, .dl-shell a, .dl-shell input, .dl-shell select, .dl-shell summary { touch-action: manipulation; }
.dl-touch-target { min-width: 44px; min-height: 44px; }
.dl-row-action { width: 44px; height: 44px; }
.dl-shell ::selection { background: oklch(0.74 0.13 252 / 0.22); }
.dl-accent-text { color: color-mix(in oklch, var(--dl-accent-strong) 54%, var(--text-strong)); }
.dl-critical-text { color: color-mix(in oklch, oklch(0.62 0.2 25) 50%, var(--text-strong)); }
.dl-mark { box-shadow: inset 0 0 0 1px oklch(0.74 0.13 252 / 0.32); }
.dl-mark::before,.dl-mark::after { content: none; position: absolute; border-radius: 999px; border: 1px solid currentColor; opacity: .45; }
.dl-mark::before { inset: 5px; border-left-color: transparent; transform: rotate(28deg); }
.dl-mark::after { inset: 9px; border-right-color: transparent; transform: rotate(-22deg); }
.dl-pop { animation: dl-pop 0.24s cubic-bezier(0.32,0.72,0,1) both; }
.dl-modal-scrim { background: var(--dl-scrim); }
.dl-command-dock { background: var(--dl-chrome, var(--background-base)); box-shadow: none; }
.dl-cleanup-dock {
  color: var(--text-weak);
  background: color-mix(in oklch, var(--surface-raised-strong) 76%, var(--background-base));
  box-shadow: inset 0 0 0 var(--dl-hairline) color-mix(in oklch, var(--border-weaker-base) 76%, transparent);
  transition: transform 150ms cubic-bezier(0.32,0.72,0,1), background-color 150ms ease-out, box-shadow 150ms ease-out;
}

.dl-cleanup-dock-empty {
  background: color-mix(in oklch, var(--background-base) 82%, var(--border-weak-base));
}

.dl-cleanup-dock-empty .dl-cleanup-dock-icon {
  box-shadow:
    inset 0 0 0 var(--dl-hairline) color-mix(in oklch, var(--text-weak) 28%, transparent),
    0 0 0 4px color-mix(in oklch, var(--text-strong) 5%, transparent);
}
.dl-cleanup-dock-icon {
  color: color-mix(in oklch, var(--dl-accent-strong) 48%, var(--text-strong));
  background: color-mix(in oklch, var(--dl-accent) 13%, var(--background-base));
  box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--dl-accent) 28%, transparent);
  transition: transform 150ms cubic-bezier(0.32,0.72,0,1);
}
.dl-cleanup-dock-filled {
  box-shadow: inset 0 0 0 var(--dl-hairline) color-mix(in oklch, var(--dl-accent) 34%, var(--border-weaker-base));
}
.dl-cleanup-dock-active {
  background: color-mix(in oklch, var(--dl-accent) 16%, var(--background-base));
  box-shadow: inset 0 0 0 2px color-mix(in oklch, var(--dl-accent) 68%, var(--text-strong));
  transform: translateY(-2px);
}
.dl-cleanup-dock-active .dl-cleanup-dock-icon { transform: scale(1.08); }
.dl-shortcut-key {
  display: grid; min-width: 28px; height: 28px; place-items: center; border-radius: 7px;
  color: var(--text-weak); background: var(--background-base);
  box-shadow: inset 0 -1px 0 rgb(127 127 127 / 0.16), inset 0 0 0 1px rgb(127 127 127 / 0.12);
  font: 600 11px/1 var(--font-family-mono); font-variant-numeric: tabular-nums;
}
.dl-dialog-surface { opacity: 0; backdrop-filter: blur(3px); transition: opacity 220ms cubic-bezier(0.32,0.72,0,1); }
.dl-dialog-panel { border-radius: 12px; border: 1px solid var(--border-weak-base); background: var(--surface-raised-base); transform: scale(0.96) translateY(4px); transition: transform 220ms cubic-bezier(0.32,0.72,0,1); }
.dl-drawer-backdrop { opacity: 0; transition: opacity 260ms cubic-bezier(0.32,0.72,0,1); }
.dl-drawer-panel { transform: translateX(100%); transition: transform 260ms cubic-bezier(0.32,0.72,0,1); }
.dl-dialog-surface[data-state="open"], .dl-drawer-surface[data-state="open"] .dl-drawer-backdrop { opacity: 1; }
.dl-dialog-surface[data-state="open"] .dl-dialog-panel, .dl-drawer-surface[data-state="open"] .dl-drawer-panel { transform: none; }
.dl-dialog-surface[data-state="closing"], .dl-drawer-surface[data-state="closing"] { pointer-events: none; }
.dl-dialog-surface[data-state="closing"], .dl-dialog-surface[data-state="closing"] .dl-dialog-panel,
.dl-drawer-surface[data-state="closing"] .dl-drawer-backdrop, .dl-drawer-surface[data-state="closing"] .dl-drawer-panel {
  transition-duration: 160ms;
  transition-timing-function: cubic-bezier(0.4,0,1,1);
}
.dl-spin { animation: dl-spin 0.8s linear infinite; }
.dl-pulse { animation: dl-pulse 1.4s ease-in-out infinite; }
.dl-preview-image-stage {
  background: var(--surface-raised-strong);
}
.dl-preview-image-stage img { animation: dl-preview-arrive 180ms cubic-bezier(0.32,0.72,0,1) both; }
.dl-scan-sweep {
  transform-origin: 200px 200px;
  animation: dl-scan-sweep 3.6s linear infinite;
}
.dl-drag-preview {
  position: fixed; left: -9999px; top: -9999px; z-index: 80; pointer-events: none;
  max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  border-radius: 12px; padding: 9px 12px; color: var(--text-strong); background: var(--background-base);
  box-shadow: 0 0 0 1px rgb(127 127 127 / 0.16), 0 12px 30px rgb(0 0 0 / 0.2);
  font: 600 12px/1.2 var(--font-family-text); font-variant-numeric: tabular-nums;
}
.dl-scan-beacon { animation: dl-scan-beacon 1.1s ease-in-out infinite; }
.dl-volume-row {
  margin-bottom: 12px; padding: 18px; gap: 12px;
  border: 1px solid var(--border-weaker-base); border-radius: 10px;
  background: var(--surface-raised-base);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.025), 0 2px 6px rgb(0 0 0 / 0.06);
}
.dl-volume-glyph {
  border-radius: 8px;
  background: color-mix(in oklch, var(--surface-raised-strong) 70%, var(--background-base));
  box-shadow: 0 0 0 var(--dl-hairline) color-mix(in oklch, var(--text-strong) 10%, transparent);
}
.dl-volume-bar {
  height: 5px;
  border-radius: 999px;
  background: color-mix(in oklch, var(--text-strong) 10%, transparent);
}
.dl-volume-bar-fill {
  height: 100%;
  border-radius: inherit;
  background: var(--dl-volume-ink);
  transition: width 220ms cubic-bezier(0.32, 0.72, 0, 1), background-color 150ms ease;
}
.dl-volume-bar-fill[data-settled] { animation: dl-volume-settle 420ms cubic-bezier(0.32, 0.72, 0, 1) 1; }
@keyframes dl-volume-settle {
  from { filter: brightness(1.35); }
  to { filter: brightness(1); }
}
.dl-volume-view {
  position: relative; min-width: 64px; height: 28px; padding: 0 10px; border-radius: 6px;
  color: var(--text-strong);
  background: color-mix(in oklch, var(--surface-raised-strong) 82%, var(--background-base));
  box-shadow: 0 0 0 var(--dl-hairline) color-mix(in oklch, var(--text-strong) 14%, transparent);
  font: 600 12px/1 var(--font-family-text);
  transition: transform 150ms ease, background-color 150ms ease, box-shadow 150ms ease;
}
.dl-volume-view::before { content: ""; position: absolute; inset: -8px; }
.dl-volume-view:active:not(:disabled) { transform: scale(0.96); }
.dl-volume-view:disabled { opacity: 0.4; }
.dl-volume-view-primary {
  background: color-mix(in oklch, var(--dl-accent) 22%, var(--background-base));
  box-shadow: 0 0 0 var(--dl-hairline) color-mix(in oklch, var(--dl-accent) 42%, transparent);
}
.dl-volume-footer {
  background: color-mix(in oklch, var(--surface-raised-strong) 42%, var(--background-base));
  box-shadow: 0 -1px 0 rgb(127 127 127 / 0.1);
}
.dl-scan-progress {
  transition: transform 220ms cubic-bezier(0.32,0.72,0,1);
}
.dl-scan-progress-ring {
  transition: stroke-dashoffset 220ms cubic-bezier(0.32,0.72,0,1);
}
.dl-scan-spinner { transform-origin: 20px 20px; animation: dl-scan-sweep 1.2s linear infinite; }
@media (prefers-reduced-motion: reduce) { .dl-scan-spinner { animation: none; } }
@keyframes dl-scan-sweep { to { transform: rotate(360deg); } }
@keyframes dl-preview-arrive { from { opacity: 0; transform: scale(0.985); } to { opacity: 1; transform: none; } }
@keyframes dl-pop { from { opacity: 0; transform: scale(0.96) translateY(4px); } to { opacity: 1; transform: none; } }
@keyframes dl-spin { to { transform: rotate(360deg); } }
@keyframes dl-pulse { 0%,100% { transform: scale(1); opacity: 0.9; } 50% { transform: scale(1.12); opacity: 1; } }
@keyframes dl-scan-beacon { 0%,100% { opacity: .42; } 50% { opacity: 1; } }
@media (hover: hover) and (pointer: fine) {
  .dl-center-open:hover {
    background: var(--surface-raised-strong);
    box-shadow: 0 0 0 1px rgb(127 127 127 / 0.2), 0 5px 14px rgb(0 0 0 / 0.14);
  }
  .dl-hover-card:hover { background: color-mix(in oklch, var(--surface-raised-base) 35%, transparent); }
  .dl-hover-card:hover .dl-hover-card-label, .dl-hover-button:hover, .dl-hover-text:hover, .dl-hover-tab:hover { color: var(--text-strong); }
  .dl-volume-view:hover:not(:disabled) {
    background: color-mix(in oklch, var(--surface-raised-base) 70%, var(--background-base));
    box-shadow: 0 0 0 var(--dl-hairline) color-mix(in oklch, var(--text-strong) 20%, transparent);
  }
  .dl-volume-view-primary:hover:not(:disabled) {
    background: color-mix(in oklch, var(--dl-accent) 30%, var(--background-base));
    box-shadow: 0 0 0 var(--dl-hairline) color-mix(in oklch, var(--dl-accent) 55%, transparent);
  }
  .dl-hover-quiet-button:hover { background: color-mix(in oklch, var(--background-base) 70%, transparent); color: var(--text-strong); opacity: 1; }
  .dl-hover-tab:hover, .dl-hover-button:hover, .dl-hover-action:hover { background: var(--surface-raised-base); }
  .dl-hover-action:hover { opacity: 1; }
  .dl-hover-action:not(.dl-accent-text):hover { color: var(--text-strong); }
  .dl-hover-row:hover { background: color-mix(in oklch, var(--surface-raised-base) 45%, transparent); }
  .dl-hover-drive:hover { background: color-mix(in oklch, var(--surface-raised-strong) 28%, transparent); }
}
/* Neutral desktop surfaces shared by the inspector, controls, and review dock. */
[data-color-scheme="dark"] .dl-shell {
  --dl-chrome: oklch(0.175 0.016 285);
  --background-base: oklch(0.205 0.018 285);
  --surface-raised-base: oklch(0.235 0.022 285);
  --surface-raised-strong: oklch(0.29 0.022 285);
  --surface-base-hover: oklch(0.27 0.01 285);
  --surface-base-active: oklch(0.3 0.01 285);
  --button-secondary-base: oklch(0.27 0.01 285);
  --button-secondary-hover: oklch(0.31 0.01 285);
  --border-weaker-base: oklch(0.31 0.018 285);
  --border-weak-base: oklch(0.35 0.008 285);
  --text-strong: oklch(0.94 0.005 285);
  --text-base: oklch(0.87 0.006 285);
  --icon-base: oklch(0.72 0.008 285);
  --icon-weak: oklch(0.65 0.008 285);
  --color-background-base: var(--background-base);
  --color-surface-raised-base: var(--surface-raised-base);
  --color-surface-raised-strong: var(--surface-raised-strong);
  --color-border-weaker-base: var(--border-weaker-base);
  --color-border-weak-base: var(--border-weak-base);
  --color-text-strong: var(--text-strong);
  --color-text-base: var(--text-base);
}
.dl-shell [data-component="button"] { border-radius: 7px; font-size: 13px; font-weight: 500; }
.dl-lens-tab, .dl-segmented { transition: background-color 140ms ease-out, color 140ms ease-out, box-shadow 140ms ease-out; }
.dl-segmented[aria-pressed="true"] { background: var(--surface-raised-strong); box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.06), 0 1px 3px rgb(0 0 0 / 0.2); }
.dl-trash-target { transition: background-color 140ms ease-out, transform 140ms ease-out; }
@media (hover: hover) {
  .dl-trash-target:hover { background: var(--surface-raised-strong); color: var(--text-strong); transform: translateY(-2px); }
  .dl-layer-cell:hover { filter: brightness(1.1); z-index: 1; }
}
.dl-layer-cell { container-type: inline-size; transition: filter 120ms ease-out; box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.12); }
@container (max-width: 55px) { .dl-layer-label { display: none; } }
@container (max-width: 90px) { .dl-layer-size { display: none; } }
.dl-view-switch { top: auto; bottom: 12px; right: auto; left: 50%; transform: translateX(-50%); border-radius: 8px; box-shadow: none; border: 0; background: transparent; }
.dl-segmented { border-radius: 6px; font-weight: 500; }
.dl-segmented-shortcut { display: none; }
.dl-lens-section { border: 0; padding-bottom: 0; }
.dl-lens-section [role="group"] { padding: 0; gap: 4px; border-radius: 0; background: transparent; border: 0; }
.dl-lens-tab { min-height: 34px; flex-direction: row; border-radius: 5px; font-weight: 500; font-size: 13px; box-shadow: none; }
.dl-lens-tab [data-component="icon"] { display: none; }
.dl-lens-tab[aria-pressed="true"] { background: var(--surface-raised-strong); box-shadow: 0 1px 3px rgb(0 0 0 / 0.12); }
.dl-inspector-summary { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dl-physical-notice { margin-top: 6px; background: transparent; border: 0; border-radius: 0; }
.dl-physical-notice summary { min-height: 30px; padding: 4px 0; }
.dl-cleanup-dock-empty { min-height: 44px; padding-block: 0; background: transparent; box-shadow: none; }
.dl-developer-policy { padding: 8px 10px; border-radius: 8px; background: transparent; }
.dl-rescan .dl-responsive-label { display: none; }
.dl-physical-notice summary { font-weight: 400; }
.dl-physical-notice summary span { font-weight: 400; color: var(--text-weak); }
.dl-search-input::-webkit-search-cancel-button { -webkit-appearance: none; }
.dl-inspector-search, .dl-sort-select { border-radius: 7px; background: var(--background-base); box-shadow: inset 0 0 0 1px var(--border-weaker-base); }
.dl-index-row { border-bottom-color: transparent; border-radius: 7px; margin-bottom: 2px; }
.dl-remainder-row { border-top: 1px solid var(--border-weaker-base); border-radius: 0; }
.dl-index-row:has([aria-current="true"]) { background: var(--surface-raised-strong); box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.035); }
.dl-index-row [data-disk-index] { padding-left: 12px; gap: 10px; }
.dl-index-row .text-13-semibold { font-size: 14px; font-weight: 500; }
.dl-cleanup-dock { border-radius: 8px; background: var(--surface-raised-base); box-shadow: inset 0 0 0 1px var(--border-weaker-base); }
.dl-command-dock-idle { display: none; }
.dl-trash-target-active { background: var(--surface-raised-strong); color: var(--text-strong); outline: 2px solid var(--text-weak); }
.dl-workspace-frame-list .dl-inspector { padding-bottom: 64px; }
.dl-command-dock-idle .dl-command-dock-inner > div:first-child { visibility: hidden; }
.dl-command-dock-idle .dl-cleanup-dock { min-height: 32px; background: transparent; box-shadow: none; }
.dl-command-dock-idle .dl-cleanup-dock kbd { display: none; }
.dl-command-dock-idle .min-h-11 { min-height: 32px; }
.dl-cleanup-dock-icon, .dl-cleanup-dock-empty .dl-cleanup-dock-icon { border-radius: 8px; background: transparent; box-shadow: none; color: var(--text-weak); }
.dl-volume-view { min-height: 36px; border-radius: 6px; }
.dl-volume-view-primary { background: var(--text-strong); color: var(--background-base); box-shadow: none; }
.dl-volume-view-primary:hover:not(:disabled) { background: color-mix(in oklch, var(--text-strong) 90%, var(--background-base)); }
.dl-volume-snapshots { margin-top: 0; }
.dl-volume-snapshots summary { min-height: 28px; }
@media (pointer: coarse) {
  .dl-touch-target { min-width: 44px !important; min-height: 44px !important; }
  .dl-search-input, .dl-smart-age-input, .dl-sort-select { font-size: 16px !important; }
  .dl-row-action { width: 44px !important; height: 44px !important; opacity: 1 !important; }
  .dl-segmented { min-height: 44px; }
}
@media only screen and (min-device-pixel-ratio: 2), only screen and (min-resolution: 192dpi) {
  .dl-shell { --dl-hairline: 0.5px; }
}
@media (max-width: 840px) {
  .dl-workspace-frame {
    display: grid;
    grid-template-rows: minmax(220px, 40%) minmax(0, 1fr);
  }
  .dl-workspace-frame.dl-workspace-frame-list { grid-template-rows: minmax(0, 1fr); }
  .dl-landscape { min-height: 0; }
  .dl-inspector { width: 100% !important; min-height: 0; border-left: 0 !important; border-top: 1px solid var(--border-weaker-base); }
  .dl-view-switch { top: auto; bottom: 10px; }
}
@media (max-width: 760px) {
  .dl-brand-name { display: none; }
  .dl-breadcrumbs, .dl-responsive-label { display: none; }
  .dl-pin-scan, .dl-rescan { width: 44px; overflow: hidden; padding-inline: 0; }
  .dl-view-switch .dl-segmented { padding-inline: 10px; }
  .dl-view-switch .dl-segmented-shortcut { display: none; }
  .dl-treemap-overlay { padding-top: 16px; }
  .dl-workspace-frame:not(.dl-workspace-frame-list) { grid-template-rows: 180px minmax(0, 1fr); }
  .dl-inspector-header { padding: 12px 16px 8px; }
  .dl-lens-section { margin-top: 8px; padding-bottom: 4px; }
  .dl-inspector-search { margin-top: 8px; }
}
@media (max-width: 640px) {
  .dl-command-dock-inner { align-items: stretch; flex-direction: column; }
  .dl-cleanup-slot { width: 100% !important; }
}
.dl-map-stage { container-type: inline-size; }
.dl-center-size { font-size: clamp(22px, 6cqw, 38px); }
.dl-center-open { background: transparent; box-shadow: none; font-weight: 400; font-size: 12px; padding-inline: 0; }
.dl-row-action { opacity: 0; }
.dl-index-row:hover .dl-row-action, .dl-row-action:focus-visible, .dl-row-action[aria-pressed="true"] { opacity: 1; }
@media (hover: none) { .dl-row-action { opacity: 1; } }
@container (max-width: 399px) {
  .dl-center-summary { max-width: 46%; }
  .dl-center-context { display: none; }
  .dl-center-open { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  .dl-shell * { animation: none !important; transition: none !important; scroll-behavior: auto !important; }
}

.dl-landscape { view-transition-name: disk-landscape; }
::view-transition-old(root), ::view-transition-new(root) { animation: none; }
::view-transition-group(disk-landscape) { animation-duration: 220ms; }
::view-transition-old(disk-landscape) { animation: dl-view-out 160ms ease-out both; }
::view-transition-new(disk-landscape) { animation: dl-view-in 220ms cubic-bezier(.22, 1, .36, 1) both; }
@keyframes dl-view-out { to { opacity: 0; transform: scale(.985); } }
@keyframes dl-view-in { from { opacity: 0; transform: scale(.985); } }
@media (prefers-reduced-motion: reduce) {
  ::view-transition-group(*), ::view-transition-old(*), ::view-transition-new(*) { animation: none !important; }
  .dl-layer-cell { transition: none; }
}
`
