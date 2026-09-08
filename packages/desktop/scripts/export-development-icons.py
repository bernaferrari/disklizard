"""Export macOS development Dock fallbacks from the Icon Composer source.
Run from any directory with Xcode installed: python3 scripts/export-development-icons.py
"""
import json
from pathlib import Path
import shutil
import subprocess
import tempfile

project = Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix="disklizard-dock-") as temporary:
    for appearance in ("light", "dark"):
        folder = Path(temporary) / appearance
        folder.mkdir()
        source = folder / "DiskLizard.icon"
        shutil.copytree(project / "icons/source/DiskLizard.icon", source)
        document = json.loads((source / "icon.json").read_text())
        document["fill"] = "system-" + appearance
        (source / "icon.json").write_text(json.dumps(document))
        output = folder / "compiled"
        output.mkdir()
        subprocess.run([
            "xcrun", "actool", str(source), "--compile", str(output),
            "--platform", "macosx", "--minimum-deployment-target", "13.0",
            "--app-icon", "DiskLizard", "--output-partial-info-plist", str(output / "info.plist"),
        ], check=True)
        iconset = folder / "dock.iconset"
        subprocess.run(["iconutil", "-c", "iconset", str(output / "DiskLizard.icns"), "-o", str(iconset)], check=True)
        shutil.copyfile(iconset / "icon_128x128@2x.png", project / f"icons/dev/dock-{appearance}.png")
