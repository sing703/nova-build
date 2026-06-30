# NovaBuild — AI Build Studio Extension

NovaBuild is a Chrome extension + Java WebSocket bridge that connects AI chat platforms (DeepSeek, ChatGPT, Arena.ai) to a local build studio for websites, games, and more.

## What's Included

```
NovaBuild/
├── extension/          Chrome extension (load unpacked)
├── bridge/             Java WebSocket bridge (port 17613)
├── start-bridge.bat    Start the bridge (the dark terminal window)
└── package.ps1         Build downloadable zip
```

## Quick Start

### 1. Generate icons (first time only)
```powershell
python scripts/generate_icons.py
```

### 2. Build the Java bridge
```powershell
cd bridge
mvn package
cd ..
```

### 3. Start the bridge
Double-click **start-bridge.bat**. You should see:
```
=== NovaBuild Bridge ===
listening on ws://127.0.0.1:17613
extension connected
```

### 4. Load the extension
1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** → select the `extension` folder

### 5. Connect an AI
1. Click the NovaBuild icon
2. Open **DeepSeek** (recommended — easiest integration)
3. **Log in manually** on the AI site (complete any captcha/security yourself)
4. Click **Connect** in the popup
5. Click **Start Building**

## Features

- **Build Studio** — Create web & game projects locally (`~/NovaBuild/projects`)
- **Live Play** — Play your app instantly at `http://127.0.0.1:17614/play/your-project` before publishing
- **Publish** — Safe localhost preview links (no fake domains that get blocked)
- **Roblox-Safe Links** — Deploy to GitHub Pages for `github.io` links Roblox allows
- **Code Architect** — See AI code changes in real-time with file tree
- **Auto-Setup** — Start Building connects bridge, creates project, and sets up AI automatically
- **GitHub** — Connect token and push projects to repos
- **Screenshot capture** — AI can see what you built via capture tools
- **AI overlay** — Draggable, resizable floating panel on chat sites

## Supported AI Platforms

| Platform   | Status      | Notes                          |
|-----------|-------------|--------------------------------|
| DeepSeek  | Recommended | Best compatibility             |
| ChatGPT   | Supported   | Manual login required          |
| Arena.ai  | Experimental| May need manual paste          |

## Important: Security & Login

NovaBuild does **not** bypass captcha or security on AI platforms. You must:
1. Open the AI site in Chrome
2. Complete login and any security checks yourself
3. Then click **Connect** in NovaBuild

The extension detects when you're logged in and injects the build assistant.

## Bridge Tools (for AI)

When connected, your AI can use these tools via the bridge:
- `create_project` — New web/game project
- `write_file` / `read_file` — Edit project files
- `list_files` / `get_project_structure` — See project architecture
- `run_preview` — Get live play URL before publishing
- `publish_project` — Publish with safe local preview links
- `publish_github_pages` — Deploy to GitHub Pages (Roblox-safe github.io link)
- `github_push` — Push to GitHub
- `capture_preview` — Screenshot current build

## Package as Zip

```powershell
.\package.ps1
```

Creates `NovaBuild-v1.0.0.zip` ready to share. Recipients extract, run `start-bridge.bat`, and load the extension.

## Requirements

- Java 17+
- Maven (to build bridge)
- Google Chrome
- Python 3 (optional, for icon generation)
