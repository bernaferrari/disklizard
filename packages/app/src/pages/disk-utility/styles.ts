export const DISK_UTILITY_STYLES = `
.dl-shell {
  --dl-accent: oklch(0.74 0.13 252);
  --dl-accent-strong: oklch(0.66 0.15 252);
  --dl-hairline: 1px;
  --text-weak: color-mix(in oklch, var(--text-strong) 68%, var(--background-base));
  --text-weaker: color-mix(in oklch, var(--text-strong) 48%, var(--background-base));
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
}
.dl-scan-tabs {
  background: color-mix(in oklch, var(--surface-raised-strong) 64%, transparent);
  box-shadow: 0 1px 0 rgb(127 127 127 / 0.08);
  scroll-padding-inline: 1rem;
  scroll-snap-type: x proximity;
}
.dl-scan-tabs-cue {
  position: absolute; inset-block: 0; z-index: 2; display: grid; width: 36px; place-items: center;
  color: var(--text-weak); pointer-events: none;
}
.dl-scan-tabs-cue-left { left: 0; background: linear-gradient(to right, var(--surface-raised-strong), transparent); }
.dl-scan-tabs-cue-right { right: 0; background: linear-gradient(to left, var(--surface-raised-strong), transparent); }
.dl-shell button, .dl-shell a, .dl-shell input, .dl-shell summary { touch-action: manipulation; }
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
  opacity: .82;
  transform-origin: 200px 200px;
  animation: dl-scan-sweep 2.8s linear infinite;
}
.dl-drag-preview {
  position: fixed; left: -9999px; top: -9999px; z-index: 80; pointer-events: none;
  max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  border-radius: 12px; padding: 9px 12px; color: var(--text-strong); background: var(--background-base);
  box-shadow: 0 0 0 1px rgb(127 127 127 / 0.16), 0 12px 30px rgb(0 0 0 / 0.2);
  font: 600 12px/1.2 var(--font-family-text); font-variant-numeric: tabular-nums;
}
.dl-scan-beacon { animation: dl-scan-beacon 1.1s ease-in-out infinite; }
.dl-scan-progress {
  transition: transform 220ms cubic-bezier(0.32,0.72,0,1);
}
.dl-scan-progress-ring {
  transition: stroke-dashoffset 220ms cubic-bezier(0.32,0.72,0,1);
}
.dl-scan-indeterminate { width: 20%; animation: dl-scan-travel 1.2s cubic-bezier(0.32,0.72,0,1) infinite alternate; }
@keyframes dl-scan-sweep { to { transform: rotate(360deg); } }
@keyframes dl-preview-arrive { from { opacity: 0; transform: scale(0.985); } to { opacity: 1; transform: none; } }
@keyframes dl-pop { from { opacity: 0; transform: scale(0.96) translateY(4px); } to { opacity: 1; transform: none; } }
@keyframes dl-spin { to { transform: rotate(360deg); } }
@keyframes dl-pulse { 0%,100% { transform: scale(1); opacity: 0.9; } 50% { transform: scale(1.12); opacity: 1; } }
@keyframes dl-scan-beacon { 0%,100% { opacity: .42; } 50% { opacity: 1; } }
@keyframes dl-scan-travel { from { transform: translateX(-100%); } to { transform: translateX(500%); } }
@media (hover: hover) and (pointer: fine) {
  .dl-center-open:hover {
    background: var(--surface-raised-strong);
    box-shadow: 0 0 0 1px rgb(127 127 127 / 0.2), 0 5px 14px rgb(0 0 0 / 0.14);
  }
  .dl-hover-card:hover { background: color-mix(in oklch, var(--surface-raised-base) 35%, transparent); }
  .dl-hover-card:hover .dl-hover-card-label, .dl-hover-button:hover, .dl-hover-text:hover, .dl-hover-tab:hover,
  .dl-hover-drive:hover .dl-hover-drive-icon { color: var(--text-strong); }
  .dl-hover-quiet-button:hover { background: color-mix(in oklch, var(--background-base) 70%, transparent); color: var(--text-strong); opacity: 1; }
  .dl-hover-brighten:hover { filter: brightness(1.05); }
  .dl-hover-tab:hover, .dl-hover-button:hover, .dl-hover-action:hover { background: var(--surface-raised-base); }
  .dl-hover-reveal:hover, .dl-hover-action:hover { opacity: 1; }
  .dl-hover-action:not(.dl-accent-text):hover { color: var(--text-strong); }
  .dl-hover-row:hover { background: color-mix(in oklch, var(--surface-raised-base) 45%, transparent); }
  .dl-hover-drive:hover { background: color-mix(in oklch, var(--surface-raised-strong) 28%, transparent); }
}
@media (pointer: coarse) {
  .dl-touch-target { min-width: 44px !important; min-height: 44px !important; }
  .dl-search-input, .dl-smart-age-input { font-size: 16px !important; }
  .dl-row-action { width: 44px !important; height: 44px !important; opacity: 1 !important; }
  .dl-segmented { min-height: 44px; }
}
@media only screen and (min-device-pixel-ratio: 2), only screen and (min-resolution: 192dpi) {
  .dl-shell { --dl-hairline: 0.5px; }
}
@media (max-width: 980px) {
  .dl-workspace-frame { flex-direction: column; }
  .dl-landscape { min-height: 52%; }
  .dl-inspector { width: 100% !important; min-height: 42%; border-left: 0 !important; border-top: 1px solid var(--border-weaker-base); }
  .dl-view-switch { top: 10px; right: 10px; }
}
@media (max-width: 760px) {
  .dl-brand-name { display: none; }
  .dl-pin-scan, .dl-rescan { max-width: 40px; overflow: hidden; }
  .dl-command-dock-inner { align-items: stretch; flex-direction: column; }
  .dl-cleanup-slot { width: 100% !important; }
}
@media (prefers-reduced-motion: reduce) {
  .dl-shell * { animation: none !important; transition: none !important; scroll-behavior: auto !important; }
}
`
