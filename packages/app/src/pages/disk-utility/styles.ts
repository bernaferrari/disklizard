import { MAC_TRAFFIC_LIGHT_INSET, WINDOWS_CAPTION_BUTTONS_INSET } from "./titlebar"

export const DISK_UTILITY_STYLES = `
.dl-shell {
  --dl-accent: oklch(0.74 0.13 252);
  --dl-accent-strong: oklch(0.66 0.15 252);
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
  background: var(--background-base);
  box-shadow:
    0 0 0 var(--dl-hairline) color-mix(in oklch, var(--border-weaker-base) 72%, transparent),
    0 18px 52px -42px rgb(0 0 0 / 0.48);
}
.dl-landscape { background: color-mix(in oklch, var(--surface-raised-strong) 30%, var(--background-base)); }
.dl-inspector { box-shadow: -12px 0 36px -36px rgb(0 0 0 / 0.42); }
.dl-topbar {
  background: color-mix(in oklch, var(--background-base) 82%, transparent);
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
.dl-mark::before,.dl-mark::after { content: ""; position: absolute; border-radius: 999px; border: 1px solid currentColor; opacity: .45; }
.dl-mark::before { inset: 5px; border-left-color: transparent; transform: rotate(28deg); }
.dl-mark::after { inset: 9px; border-right-color: transparent; transform: rotate(-22deg); }
.dl-pop { animation: dl-pop 0.24s cubic-bezier(0.32,0.72,0,1) both; }
.dl-modal-scrim { background: var(--dl-scrim); }
.dl-command-dock { box-shadow: 0 -1px 0 rgb(127 127 127 / 0.06); }
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
.dl-dialog-surface { opacity: 0; backdrop-filter: blur(12px); transition: opacity 220ms cubic-bezier(0.32,0.72,0,1); }
.dl-dialog-panel { transform: scale(0.96) translateY(4px); transition: transform 220ms cubic-bezier(0.32,0.72,0,1); }
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
  min-height: 72px;
  box-shadow: 0 1px 0 rgb(127 127 127 / 0.1);
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
  .dl-view-switch { top: 10px; right: 10px; }
}
@media (max-width: 760px) {
  .dl-brand-name { display: none; }
  .dl-breadcrumbs, .dl-responsive-label { display: none; }
  .dl-pin-scan, .dl-rescan { width: 44px; overflow: hidden; padding-inline: 0; }
  .dl-view-switch .dl-segmented { padding-inline: 10px; }
  .dl-view-switch .dl-segmented-icon, .dl-view-switch .dl-segmented-shortcut { display: none; }
  .dl-treemap-overlay { padding-top: 64px; }
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
@container (max-width: 399px) {
  .dl-center-summary { max-width: 46%; }
  .dl-center-context { display: none; }
  .dl-center-open { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  .dl-shell * { animation: none !important; transition: none !important; scroll-behavior: auto !important; }
}
`
