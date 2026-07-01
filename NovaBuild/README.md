# Nova OP-Scripter

Connect free AI chat sites to **Roblox Studio** through **Novaect** — a local WebSocket bridge that auto-links MCP servers (Roblox Studio MCP and any others in `config.json`).

## Quick start

1. **Load the extension** in Chrome/Edge: `chrome://extensions` → Developer mode → Load unpacked → select the `extension` folder.
2. **Run Novaect** (keep the window open):
   ```
   start-novaect.bat
   ```
3. **Open Roblox Studio** with your place, enable **Assistant → MCP Servers → Studio as MCP Server**.
4. Open a supported AI site, log in, click **▶ Start Studio agent**.

## Supported AIs

| AI | URL |
|----|-----|
| DeepSeek | chat.deepseek.com |
| ChatGPT | chatgpt.com |
| Claude | claude.ai |
| Gemini | gemini.google.com |
| Kimi | kimi.com |
| GLM | chat.z.ai |
| Qwen | chat.qwen.ai |
| Arena | arena.ai |

## Novaect

Novaect replaces the old NovaBuild local file bridge. It connects your browser extension to Roblox Studio via MCP:

- **Port:** `ws://127.0.0.1:17613`
- **Config:** `novaect/config.json` — add more MCP servers to auto-link them
- **Must stay running** while using OP-Scripter
- **Studio must be open** with a place loaded and MCP enabled

## Project memory

The AI stores durable project notes in `game.ServerStorage.Nova.Memory` inside your place file — shared across all AI sessions.

## OP-Scripter capabilities

- Advanced GUI building (UICorner, gradients, responsive layouts)
- Realistic maps and PBR materials via Studio MCP + generate tools
- **screen_capture** — photograph Studio viewport so vision AIs can see placement errors
- Full Luau scripting via execute_luau, multi_edit, script_read

## Docs

- [Roblox Studio MCP setup](https://create.roblox.com/docs/en-us/studio/mcp)

## License

Extension bridge code adapted under GPL-3.0-or-later (from ZeroScript-Free).
