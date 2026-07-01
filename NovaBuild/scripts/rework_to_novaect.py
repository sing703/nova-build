#!/usr/bin/env python3
"""One-time migration: rework NovaBuild into Nova OP-Scripter + Novaect bridge."""
import os
import re
import shutil

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ZS = os.path.join(os.path.dirname(ROOT), "ZeroScript-Free-master", "ZeroScript-Free-master")
if not os.path.isdir(ZS):
    ZS = os.path.join(os.path.dirname(ROOT), "ZeroScript-Free-master")

EXT = os.path.join(ROOT, "extension")
NOVAECT = os.path.join(ROOT, "novaect")

REPLACEMENTS = [
    ("ZeroScript Free", "Nova OP-Scripter"),
    ("ZeroScript", "Nova"),
    ("zeroscript-bridge", "novaect-bridge"),
    ("ZS_BRIDGE_PORT", "NOVAECT_PORT"),
    ("⟦ZS-SYS⟧", "⟦NV-SYS⟧"),
    ("ServerStorage.Nova.Memory", "ServerStorage.Nova.Memory"),  # noop anchor
    ("ServerStorage.ZeroScript.Memory", "ServerStorage.Nova.Memory"),
    ("ZeroScript folder", "Nova folder"),
    ("the ZeroScript folder", "the Nova folder"),
    ("auto-creates the ZeroScript folder", "auto-creates the Nova folder"),
    ("ZeroScript commands", "Nova commands"),
    ("ZeroScript command", "Nova command"),
    ("ZeroScript reads", "Nova reads"),
    ("ZeroScript fills", "Nova fills"),
    ("from ZeroScript", "from Nova"),
    ("ZeroScript Bridge", "Novaect"),
    ("ZeroScript bridge", "Novaect"),
    ("the bridge", "Novaect"),
    ("bridge.py", "novaect.py"),
    ("start.bat", "start-novaect.bat"),
    ("[zeroscript]", "[nova]"),
    ("[zs-diag]", "[nv-diag]"),
    ("[zs-bg]", "[nv-bg]"),
    ("__zsDiag", "__nvDiag"),
    ("zs-diag-log", "nv-diag-log"),
    ("zsSetupSeen", "nvSetupSeen"),
    ("zsCustomPrompt", "nvCustomPrompt"),
    ("zsStartedSessions", "nvStartedSessions"),
    ("zs-status", "nv-status"),
    ("ZSProvider", "NVProvider"),
    ("ZSParse", "NVParse"),
    ("const ZS =", "const NV ="),
    ("ZS.", "NV."),
    ("ZSProvider", "NVProvider"),
    ("html.zs-light", "html.nv-light"),
    ("zs-light", "nv-light"),
    ("zs-prov-", "nv-prov-"),
    ("#zs-", "#nv-"),
    (".zs-", ".nv-"),
    ("id=\"zs-", "id=\"nv-"),
    ("'zs-", "'nv-"),
    ('"zs-', '"nv-'),
    ("dataset.zs", "dataset.nv"),
    ("dataset.zsig", "dataset.nvsig"),
    ("dataset.zphase", "dataset.nvphase"),
    ("@keyframes zs-", "@keyframes nv-"),
    ("GITHUB_URL", "SETUP_URL"),
    ("https://github.com/sebattfg/ZeroScript-Free", "https://create.roblox.com/docs/en-us/studio/mcp"),
    ("https://youtu.be/QaViHSqzy5Q", "https://create.roblox.com/docs/en-us/studio/mcp"),
]

def transform(text):
    for old, new in REPLACEMENTS:
        text = text.replace(old, new)
    # Fix double-replacements
    text = text.replace("Novaectect", "Novaect")
    text = text.replace("Nova OP-Scripter OP-Scripter", "Nova OP-Scripter")
    return text

def copy_tree(src, dst, exts=(".js", ".css", ".html", ".json", ".py", ".bat", ".md")):
    os.makedirs(dst, exist_ok=True)
    for root, dirs, files in os.walk(src):
        rel = os.path.relpath(root, src)
        out_dir = os.path.join(dst, rel) if rel != "." else dst
        os.makedirs(out_dir, exist_ok=True)
        for f in files:
            if exts and not f.endswith(exts) and f not in ("icon.png", "test-parser.js"):
                if f.endswith(".png"):
                    shutil.copy2(os.path.join(root, f), os.path.join(out_dir, f))
                continue
            src_path = os.path.join(root, f)
            dst_path = os.path.join(out_dir, f)
            if f.endswith((".js", ".css", ".html", ".json", ".py", ".bat", ".md")):
                with open(src_path, "r", encoding="utf-8", errors="replace") as fh:
                    content = transform(fh.read())
                with open(dst_path, "w", encoding="utf-8", newline="\n") as fh:
                    fh.write(content)
            else:
                shutil.copy2(src_path, dst_path)

def remove_old():
    for path in [
        os.path.join(ROOT, "bridge"),
        os.path.join(ROOT, "bridge-python"),
        os.path.join(ROOT, "start-bridge.bat"),
        os.path.join(ROOT, "scripts", "build-bridge.ps1"),
        os.path.join(EXT, "studio"),
        os.path.join(EXT, "background"),
        os.path.join(EXT, "content"),
        os.path.join(EXT, "popup"),
        os.path.join(EXT, "icons"),
    ]:
        if os.path.isdir(path):
            shutil.rmtree(path, ignore_errors=True)
        elif os.path.isfile(path):
            os.remove(path)

def setup_novaect():
    os.makedirs(NOVAECT, exist_ok=True)
    shutil.copy2(os.path.join(ZS, "launch_studio_mcp.py"), os.path.join(NOVAECT, "launch_studio_mcp.py"))
    with open(os.path.join(ZS, "bridge.py"), "r", encoding="utf-8") as fh:
        bridge = transform(fh.read())
    bridge = bridge.replace("bridge.py", "novaect.py")
    bridge = bridge.replace("[bridge]", "[novaect]")
    with open(os.path.join(NOVAECT, "novaect.py"), "w", encoding="utf-8", newline="\n") as fh:
        fh.write(bridge)
    config = {
        "mcpServers": {
            "roblox": {"command": "launch_studio_mcp.py", "args": []}
        },
        "_comment": "Add more MCP servers here - Novaect auto-links them on startup."
    }
    import json
    with open(os.path.join(NOVAECT, "config.json"), "w", encoding="utf-8") as fh:
        json.dump(config, fh, indent=2)
    with open(os.path.join(ZS, "start.bat"), "r", encoding="utf-8") as fh:
        bat = transform(fh.read())
    bat = bat.replace("bridge.py", "novaect.py")
    bat = bat.replace("ZeroScript Bridge", "Novaect")
    bat = bat.replace("title ZeroScript Bridge", "title Novaect")
    with open(os.path.join(NOVAECT, "start-novaect.bat"), "w", encoding="utf-8", newline="\r\n") as fh:
        fh.write(bat)
    shutil.copy2(os.path.join(NOVAECT, "start-novaect.bat"), os.path.join(ROOT, "start-novaect.bat"))

def main():
    if not os.path.isdir(os.path.join(ZS, "zeroscript-extension")):
        raise SystemExit(f"ZeroScript not found at {ZS}")
    remove_old()
    zs_ext = os.path.join(ZS, "zeroscript-extension")
    copy_tree(zs_ext, EXT)
    setup_novaect()
    print("Migration complete:", ROOT)

if __name__ == "__main__":
    main()
