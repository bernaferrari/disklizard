# Desktop icons

The macOS source is `source/DiskLizard.icon`, an Icon Composer document with a disk PNG layer and an automatic system background. `scripts/compile-macos-icon.ts` compiles its native appearances into the packaged app's `Assets.car` and `DiskLizard.icns` before signing. Packaged apps must not replace this icon with `app.dock.setIcon()`, which would hide native appearance variants.

Unpackaged Electron uses `dev/dock-light.png` and `dev/dock-dark.png` as Dock fallbacks. They are exported with Apple's asset compiler from temporary copies of the same Composer document, using its system-light and system-dark backgrounds. Regenerate them with:

```sh
python3 packages/desktop/scripts/export-development-icons.py
```

`predev` copies the selected channel's icons to `resources/icons`. The development Dock icon follows `nativeTheme` appearance changes. Other platforms use their existing PNG/ICO assets.
