// SPDX-License-Identifier: GPL-3.0-or-later
function render(s) {
  const dot = document.getElementById("dot");
  const state = document.getElementById("state");
  const tools = document.getElementById("tools");
  const servers = document.getElementById("servers");
  const list = s.servers || [];
  const up = list.filter((x) => x.alive).length;
  const mcpOk = s.connected && (s.mcpAlive || up > 0 || s.tools > 0);
  const studioOff = mcpOk && s.studio === false;
  const ok = mcpOk && !studioOff;
  dot.className = "dot " + (s.connected ? (ok ? "on" : "warn") : "");
  state.textContent = s.connected
    ? (ok ? "Novaect connected · Studio ready"
        : studioOff ? "Studio not linked · open a place + enable MCP"
        : "Novaect OK · open Roblox Studio")
    : "Novaect offline";
  tools.textContent = s.connected ? `${s.tools || 0} MCP tools available` : "Run start-novaect.bat";
  servers.textContent = s.connected
    ? list.map((x) => `${x.alive ? "●" : "○"} ${x.id} (${x.alive ? x.tools + " tools" : "down"})`).join("\n")
    : "";
}

function refresh() {
  chrome.runtime.sendMessage({ type: "status" }, (s) => s && render(s));
}

document.getElementById("reconnect").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "reconnect" }, () => setTimeout(refresh, 600));
});
document.getElementById("restart").addEventListener("click", (e) => {
  e.target.textContent = "Restarting…";
  chrome.runtime.sendMessage({ type: "restart_mcp" }, () => {
    e.target.textContent = "⟳ Restart Roblox MCP";
    setTimeout(refresh, 600);
  });
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === "nv-status") render(msg);
});
refresh();
setInterval(refresh, 2000);
