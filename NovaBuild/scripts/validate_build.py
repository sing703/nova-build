#!/usr/bin/env python3
"""Quick validation tests for NovaBuild extension providers and novaect."""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EXT = ROOT / "extension"
PROVIDERS = EXT / "providers"

errors = []


def check(name, ok, msg):
    if not ok:
        errors.append(f"{name}: {msg}")
    print(f"  {'PASS' if ok else 'FAIL'}  {name}" + (f" — {msg}" if not ok else ""))


def main():
    print("NovaBuild validation\n")

    manifest = json.loads((EXT / "manifest.json").read_text(encoding="utf-8"))
    bg = (EXT / "background.js").read_text(encoding="utf-8")
    urls = re.findall(r'"https://[^"]+/\*"', bg)
    manifest_hosts = manifest.get("host_permissions", [])

    for prov_file in sorted(PROVIDERS.glob("*.js")):
        if prov_file.name == "qwen-net.js":
            continue
        text = prov_file.read_text(encoding="utf-8")
        check(
            f"{prov_file.name} ensureComposerReady",
            "return { ready" in text or "return { ...state, ready" in text,
            "must return { ready: ... } object, not bare boolean",
        )

    check("manifest.json valid", manifest.get("manifest_version") == 3, "bad manifest")
    check("version bumped", manifest.get("version") in ("2.1.0", "2.2.0"), f"got {manifest.get('version')}")

    cs_providers = {p.name for p in PROVIDERS.glob("*.js") if p.name != "qwen-net.js"}
    wired = set()
    for cs in manifest.get("content_scripts", []):
        for js in cs.get("js", []):
            if js.startswith("providers/"):
                wired.add(js.split("/")[-1])
    missing_manifest = cs_providers - wired
    check("all providers in manifest", not missing_manifest, str(missing_manifest))

    novaect = (ROOT / "novaect" / "novaect.py").read_text(encoding="utf-8")
    check("multi-angle capture", "multi_angle_screen_capture" in novaect, "missing function")
    check("screen_capture intercept", 'name == "screen_capture"' in novaect, "missing intercept")

    print()
    if errors:
        print(f"{len(errors)} error(s):")
        for e in errors:
            print(" -", e)
        return 1
    print("All checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
