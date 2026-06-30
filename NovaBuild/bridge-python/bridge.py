#!/usr/bin/env python3
"""NovaBuild Bridge — Python fallback (same protocol as Java bridge)."""
import asyncio
import json
import re
import uuid
import base64
import urllib.request
import threading
from http.server import HTTPServer, SimpleHTTPRequestHandler
from datetime import datetime, timezone
from pathlib import Path

try:
    import websockets
except ImportError:
    print("[2/3] Installing websockets library...")
    import subprocess
    subprocess.check_call(["pip", "install", "websockets", "-q"])
    import websockets

PORT = 17613
PREVIEW_PORT = 17614
ROOT = Path.home() / "NovaBuild"
PROJECTS = ROOT / "projects"
PUBLISHED = ROOT / "published"
CONFIG = ROOT / "config.json"


def cyan(s): return f"\033[96m{s}\033[0m"
def green(s): return f"\033[92m{s}\033[0m"
def dim(s): return f"\033[90m{s}\033[0m"


def ensure_workspace():
    PROJECTS.mkdir(parents=True, exist_ok=True)
    PUBLISHED.mkdir(parents=True, exist_ok=True)
    if not CONFIG.exists():
        CONFIG.write_text(json.dumps({
            "githubToken": "", "githubUsername": "",
            "defaultPublishDomain": "novabuild.local",
            "createdAt": datetime.now(timezone.utc).isoformat()
        }, indent=2))


def slugify(s):
    return re.sub(r"^-|-$", "", re.sub(r"[^a-z0-9]+", "-", s.lower()))


def starter_web(name):
    return f"""<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>{name}</title>
<link rel="stylesheet" href="style.css"></head>
<body><main class="hero"><h1>{name}</h1>
<p>Built with NovaBuild.</p><button id="action">Get Started</button></main>
<script src="script.js"></script></body></html>"""


def starter_css():
    return """body{font-family:system-ui;background:#0f172a;color:#f8fafc;min-height:100vh;display:grid;place-items:center}
.hero{text-align:center;padding:2rem}button{background:#6366f1;color:#fff;border:none;padding:.75rem 1.5rem;border-radius:999px;cursor:pointer}"""


def starter_js(game=False):
    if game:
        return "const c=document.getElementById('game');const x=c.getContext('2d');let px=50,py=50;function l(){x.fillStyle='#020617';x.fillRect(0,0,640,480);x.fillStyle='#22d3ee';x.fillRect(px,py,24,24);px+=2;requestAnimationFrame(l)}l();"
    return "document.getElementById('action')?.addEventListener('click',()=>alert('NovaBuild ready!'));"


def list_tools():
    return [
        {"name": "list_projects", "description": "List all NovaBuild projects", "parameters": {}},
        {"name": "create_project", "description": "Create web or game project", "parameters": {"name": "string", "type": "web|game"}},
        {"name": "read_file", "description": "Read project file", "parameters": {"projectId": "string", "path": "string"}},
        {"name": "write_file", "description": "Write project file", "parameters": {"projectId": "string", "path": "string", "content": "string"}},
        {"name": "list_files", "description": "List all files in a project", "parameters": {"projectId": "string"}},
        {"name": "get_project_structure", "description": "Get project architecture", "parameters": {"projectId": "string"}},
        {"name": "run_preview", "description": "Get live preview URL", "parameters": {"projectId": "string"}},
        {"name": "publish_project", "description": "Publish with safe local preview links", "parameters": {"projectId": "string", "slug": "string"}},
        {"name": "publish_github_pages", "description": "Deploy to GitHub Pages for Roblox-safe link", "parameters": {"projectId": "string", "slug": "string"}},
        {"name": "capture_preview", "description": "Request screenshot capture", "parameters": {"projectId": "string", "url": "string"}},
        {"name": "github_status", "description": "GitHub connection status", "parameters": {}},
        {"name": "github_connect", "description": "Save GitHub credentials", "parameters": {"token": "string", "username": "string"}},
        {"name": "github_push", "description": "Push to GitHub repo", "parameters": {"projectId": "string", "repo": "string"}},
        {"name": "get_workspace_info", "description": "Workspace paths and config", "parameters": {}},
    ]


def play_url(project_id):
    return f"http://127.0.0.1:{PREVIEW_PORT}/play/{project_id}/"


def published_url(slug):
    return f"http://127.0.0.1:{PREVIEW_PORT}/published/{slug}/"


def execute_tool(name, args):
    try:
        if name == "list_projects":
            projects = []
            for d in PROJECTS.iterdir():
                meta = d / "project.json"
                if d.is_dir() and meta.exists():
                    m = json.loads(meta.read_text())
                    m["id"] = d.name
                    projects.append(m)
            return {"success": True, "data": {"projects": projects}}

        if name == "create_project":
            pname = args.get("name", "Untitled")
            ptype = args.get("type", "web")
            pid = slugify(pname) + "-" + uuid.uuid4().hex[:8]
            pdir = PROJECTS / pid
            pdir.mkdir(parents=True)
            meta = {"name": pname, "type": ptype, "createdAt": datetime.now(timezone.utc).isoformat(), "publishSlug": pid}
            (pdir / "project.json").write_text(json.dumps(meta, indent=2))
            (pdir / "index.html").write_text(starter_web(pname))
            (pdir / "style.css").write_text(starter_css())
            (pdir / "script.js").write_text(starter_js(ptype == "game"))
            meta["id"] = pid
            meta["path"] = str(pdir)
            meta["previewUrl"] = play_url(pid)
            return {"success": True, "data": meta}

        if name == "read_file":
            content = (PROJECTS / args["projectId"] / args.get("path", "index.html")).read_text()
            return {"success": True, "data": {"content": content}}

        if name == "write_file":
            path = PROJECTS / args["projectId"] / args.get("path", "index.html")
            path.parent.mkdir(parents=True, exist_ok=True)
            content = args.get("content", "")
            path.write_text(content)
            return {"success": True, "data": {
                "written": True, "projectId": args["projectId"],
                "path": args.get("path", "index.html"),
                "previewUrl": play_url(args["projectId"]),
                "lines": len(content.split("\n"))
            }}

        if name == "list_files":
            pdir = PROJECTS / args["projectId"]
            files = [{"path": str(f.relative_to(pdir)).replace("\\", "/"), "size": f.stat().st_size}
                     for f in pdir.rglob("*") if f.is_file()]
            return {"success": True, "data": {"files": files}}

        if name == "get_project_structure":
            pdir = PROJECTS / args["projectId"]
            files = [{"path": str(f.relative_to(pdir)).replace("\\", "/"), "size": f.stat().st_size}
                     for f in pdir.rglob("*") if f.is_file()]
            meta = json.loads((pdir / "project.json").read_text()) if (pdir / "project.json").exists() else {}
            return {"success": True, "data": {"projectId": args["projectId"], "files": files, "meta": meta}}

        if name == "run_preview":
            return {"success": True, "data": {"previewUrl": play_url(args["projectId"])}}

        if name == "publish_project":
            src = PROJECTS / args["projectId"]
            slug = slugify(args.get("slug") or args["projectId"])
            dst = PUBLISHED / slug
            if dst.exists():
                import shutil
                shutil.rmtree(dst)
            import shutil
            shutil.copytree(src, dst)
            pub = {
                "projectId": args["projectId"], "slug": slug,
                "previewUrl": published_url(slug),
                "playUrl": play_url(args["projectId"]),
                "localPath": str(dst),
                "publishedAt": datetime.now(timezone.utc).isoformat(),
                "robloxNote": "Use publish_github_pages for Roblox-safe github.io links."
            }
            cfg = json.loads(CONFIG.read_text())
            gh_user = cfg.get("githubUsername", "")
            if gh_user:
                pub["robloxSafeUrl"] = f"https://{gh_user}.github.io/novabuild-{slug}/"
            (dst / "publish.json").write_text(json.dumps(pub, indent=2))
            return {"success": True, "data": pub}

        if name == "publish_github_pages":
            return {"success": False, "error": "Use Java bridge for GitHub Pages deploy, or github_push first."}

        if name == "capture_preview":
            return {"success": True, "data": {"action": "capture_request", **args}}

        if name == "github_status":
            cfg = json.loads(CONFIG.read_text())
            return {"success": True, "data": {"connected": bool(cfg.get("githubToken")), "username": cfg.get("githubUsername", "")}}

        if name == "github_connect":
            cfg = json.loads(CONFIG.read_text())
            cfg["githubToken"] = args.get("token", "")
            cfg["githubUsername"] = args.get("username", "")
            CONFIG.write_text(json.dumps(cfg, indent=2))
            return {"success": True, "data": {"connected": True}}

        if name == "github_push":
            cfg = json.loads(CONFIG.read_text())
            token = cfg.get("githubToken", "")
            if not token:
                raise ValueError("GitHub not connected")
            repo = args["repo"].replace("https://github.com/", "")
            owner, repo_name = repo.split("/")[:2]
            content = (PROJECTS / args["projectId"] / "index.html").read_bytes()
            encoded = base64.b64encode(content).decode()
            body = json.dumps({"message": "NovaBuild update", "content": encoded}).encode()
            req = urllib.request.Request(
                f"https://api.github.com/repos/{owner}/{repo_name}/contents/index.html",
                data=body, method="PUT",
                headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json",
                         "Content-Type": "application/json"})
            with urllib.request.urlopen(req) as resp:
                resp.read()
            return {"success": True, "data": {"pushed": True, "repo": repo, "url": f"https://github.com/{repo}"}}

        if name == "get_workspace_info":
            return {"success": True, "data": {"projectsPath": str(PROJECTS), "publishedPath": str(PUBLISHED),
                                              "previewBase": f"http://127.0.0.1:{PREVIEW_PORT}",
                                              "config": json.loads(CONFIG.read_text())}}

        return {"success": False, "error": f"Unknown tool: {name}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


clients = set()


class PreviewHandler(SimpleHTTPRequestHandler):
  def log_message(self, format, *args):
    pass

  def do_GET(self):
    path = self.path.split("?", 1)[0]
    if path.startswith("/play/"):
      rest = path[len("/play/"):]
      return self._serve(PROJECTS, rest)
    if path.startswith("/published/"):
      rest = path[len("/published/"):]
      return self._serve(PUBLISHED, rest)
    if path == "/health":
      self.send_response(200)
      self.send_header("Content-Type", "application/json")
      self.send_header("Access-Control-Allow-Origin", "*")
      self.end_headers()
      self.wfile.write(b'{"ok":true}')
      return
    self.send_error(404)

  def _serve(self, base, rest):
    parts = rest.strip("/").split("/", 1)
    if not parts or not parts[0]:
      self.send_error(404)
      return
    project_id = parts[0]
    file_path = parts[1] if len(parts) > 1 else "index.html"
    full = (base / project_id / file_path).resolve()
    root = (base / project_id).resolve()
    if not str(full).startswith(str(root)) or not full.exists():
      fallback = root / "index.html"
      if fallback.exists():
        full = fallback
      else:
        self.send_error(404)
        return
    self.send_response(200)
    ext = full.suffix.lower()
    types = {".html": "text/html", ".css": "text/css", ".js": "application/javascript", ".json": "application/json"}
    self.send_header("Content-Type", types.get(ext, "application/octet-stream"))
    self.send_header("Access-Control-Allow-Origin", "*")
    self.end_headers()
    self.wfile.write(full.read_bytes())


def start_preview_server():
  server = HTTPServer(("127.0.0.1", PREVIEW_PORT), PreviewHandler)
  thread = threading.Thread(target=server.serve_forever, daemon=True)
  thread.start()
  return server


async def handler(ws):
    clients.add(ws)
    addr = ws.remote_address[0] if ws.remote_address else "?"
    print(f"extension connected ({addr}) [{len(clients)} client(s)]")
    await ws.send(json.dumps({
        "type": "bridge_ready", "version": "1.1.0",
        "previewPort": PREVIEW_PORT,
        "previewBase": f"http://127.0.0.1:{PREVIEW_PORT}",
        "tools": list_tools()
    }))
    try:
        async for message in ws:
            req = json.loads(message)
            t = req.get("type", "")
            if t == "ping":
                await ws.send(json.dumps({"type": "pong"}))
            elif t == "list_tools":
                await ws.send(json.dumps({"type": "tools_list", "tools": list_tools()}))
            elif t == "tool_call":
                result = execute_tool(req.get("tool"), req.get("args") or {})
                await ws.send(json.dumps({"type": "tool_result", "requestId": req.get("requestId", ""),
                                          "tool": req.get("tool"), "result": result}))
            else:
                await ws.send(json.dumps({"type": "error", "message": f"Unknown: {t}"}))
    finally:
        clients.discard(ws)
        print(dim(f"client disconnected [{len(clients)} client(s)]"))


async def main():
    print()
    print(cyan("=== NovaBuild Bridge (Python) ==="))
    print("[1/3] Looking for Python... OK")
    print("[2/3] Checking websockets library... OK")
    print("[3/3] Starting bridge...")
    ensure_workspace()
    start_preview_server()
    print(green(f"NovaBuild Bridge listening on ws://127.0.0.1:{PORT}"))
    print(green(f"Preview server at http://127.0.0.1:{PREVIEW_PORT}"))
    print(green(f"ready ({len(list_tools())} tools)"))
    print(green("Load the extension and open chat.deepseek.com"))
    print(dim("Press Ctrl+C to stop"))
    async with websockets.serve(handler, "127.0.0.1", PORT):
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())
