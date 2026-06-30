const BRIDGE_URL = 'ws://127.0.0.1:17613';
const PREVIEW_BASE = 'http://127.0.0.1:17614';
const RECONNECT_MS = 1500;
const MAX_RECONNECT_MS = 12000;
const PING_MS = 8000;

let ws = null;
let reconnectTimer = null;
let pingTimer = null;
let reconnectDelay = RECONNECT_MS;
let pendingRequests = new Map();
let requestCounter = 0;
let bridgeConnected = false;
let previewBase = PREVIEW_BASE;

const aiState = {
  deepseek: { loggedIn: false, active: false },
  chatgpt: { loggedIn: false, active: false },
  arena: { loggedIn: false, active: false }
};

function connectBridge() {
  if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
    return;
  }

  try {
    ws = new WebSocket(BRIDGE_URL);

    ws.onopen = () => {
      bridgeConnected = true;
      reconnectDelay = RECONNECT_MS;
      startPing();
      broadcastStatus();
      chrome.runtime.sendMessage({ type: 'bridge_status', connected: true }).catch(() => {});
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        handleBridgeMessage(msg);
      } catch (e) {
        console.error('[NovaBuild] bridge parse error', e);
      }
    };

    ws.onclose = () => {
      bridgeConnected = false;
      stopPing();
      broadcastStatus();
      chrome.runtime.sendMessage({ type: 'bridge_status', connected: false }).catch(() => {});
      scheduleReconnect();
    };

    ws.onerror = () => {
      ws?.close();
    };
  } catch (e) {
    scheduleReconnect();
  }
}

function startPing() {
  stopPing();
  pingTimer = setInterval(() => {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'ping' }));
    }
  }, PING_MS);
}

function stopPing() {
  clearInterval(pingTimer);
}

function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    connectBridge();
    reconnectDelay = Math.min(reconnectDelay * 1.5, MAX_RECONNECT_MS);
  }, reconnectDelay);
}

async function logCodeActivity(tool, args, result) {
  const data = result?.data || {};
  const entry = {
    id: `act_${Date.now()}`,
    tool,
    timestamp: new Date().toISOString(),
    projectId: data.projectId || args?.projectId || '',
    path: data.path || args?.path || '',
    previewUrl: data.previewUrl || data.playUrl || '',
    lines: data.lines || 0,
    success: result?.success !== false
  };

  if (tool === 'write_file' && args?.content) {
    entry.code = args.content;
    entry.language = guessLanguage(entry.path);
  }
  if (tool === 'create_project') {
    entry.code = '// New project created: ' + (data.name || args?.name || 'Untitled');
    entry.language = 'info';
  }
  if (tool === 'read_file' && data.content) {
    entry.code = data.content;
    entry.language = guessLanguage(entry.path);
  }

  const stored = await chrome.storage.local.get('codeArchitect');
  const log = stored.codeArchitect || [];
  log.unshift(entry);
  await chrome.storage.local.set({ codeArchitect: log.slice(0, 100) });

  chrome.runtime.sendMessage({ type: 'code_activity', entry }).catch(() => {});
}

function guessLanguage(path) {
  if (!path) return 'text';
  if (path.endsWith('.html') || path.endsWith('.htm')) return 'html';
  if (path.endsWith('.css')) return 'css';
  if (path.endsWith('.js')) return 'javascript';
  if (path.endsWith('.json')) return 'json';
  return 'text';
}

function handleBridgeMessage(msg) {
  if (msg.type === 'bridge_ready') {
    chrome.storage.local.set({
      bridgeTools: msg.tools || [],
      previewBase: msg.previewBase || PREVIEW_BASE
    });
    if (msg.previewBase) previewBase = msg.previewBase;
  }

  if (msg.type === 'tool_activity') {
    logCodeActivity(msg.tool, msg.args, msg.result);
  }

  if (msg.type === 'tool_result' && msg.requestId) {
    const pending = pendingRequests.get(msg.requestId);
    if (pending) {
      pendingRequests.delete(msg.requestId);
      pending.resolve(msg.result);
      if (msg.result?.success) {
        logCodeActivity(msg.tool, pending.args, msg.result);
      }
    }
  }

  if (msg.type === 'tool_result') {
    const result = msg.result?.data;
    if (result?.action === 'capture_request') {
      handleCaptureRequest(result);
    }
  }

  chrome.runtime.sendMessage({ type: 'bridge_message', payload: msg }).catch(() => {});
}

async function handleCaptureRequest(request) {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab?.id) return;

  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
    callTool('capture_preview', {
      projectId: request.projectId,
      url: request.url,
      screenshot: dataUrl
    }).catch(() => {});
  } catch (e) {
    console.warn('[NovaBuild] capture failed', e);
  }
}

function callTool(tool, args = {}) {
  return new Promise((resolve, reject) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      reject(new Error('Bridge not connected. Start NovaBuild Bridge first.'));
      return;
    }

    const requestId = `req_${++requestCounter}_${Date.now()}`;
    pendingRequests.set(requestId, { resolve, reject, args });

    ws.send(JSON.stringify({ type: 'tool_call', tool, args, requestId }));

    setTimeout(() => {
      if (pendingRequests.has(requestId)) {
        pendingRequests.delete(requestId);
        reject(new Error('Tool call timed out'));
      }
    }, 45000);
  });
}

function broadcastStatus() {
  chrome.storage.local.set({
    bridgeConnected,
    aiState,
    previewBase
  });
}

chrome.runtime.onInstalled.addListener(() => {
  connectBridge();
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});
});

chrome.runtime.onStartup.addListener(connectBridge);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse).catch(err => sendResponse({ error: err.message }));
  return true;
});

async function handleMessage(message, sender) {
  switch (message.type) {
    case 'get_status':
      return { bridgeConnected, aiState, previewBase };

    case 'connect_bridge':
      connectBridge();
      return { ok: true };

    case 'call_tool':
      return await callTool(message.tool, message.args || {});

    case 'set_ai_active':
      if (aiState[message.provider]) {
        aiState[message.provider].active = message.active;
        aiState[message.provider].loggedIn = message.loggedIn ?? aiState[message.provider].loggedIn;
        broadcastStatus();
      }
      return { ok: true };

    case 'set_ai_logged_in':
      if (aiState[message.provider]) {
        aiState[message.provider].loggedIn = message.loggedIn;
        broadcastStatus();
      }
      return { ok: true };

    case 'start_building':
      return await startBuilding(message.provider, message.autoSetup !== false);

    case 'open_studio': {
      let windowId = message.windowId;
      if (!windowId) {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        windowId = tab?.windowId;
      }
      if (windowId) await chrome.sidePanel.open({ windowId });
      return { ok: true };
    }

    case 'capture_tab':
      return await captureActiveTab();

    case 'get_preview_url':
      return { url: `${previewBase}/play/${message.projectId}/` };

    case 'open_preview':
      const url = message.url || `${previewBase}/play/${message.projectId}/`;
      await chrome.tabs.create({ url });
      return { ok: true, url };

    default:
      return { error: 'Unknown message type' };
  }
}

async function ensureBridgeConnected(maxAttempts = 5) {
  for (let i = 0; i < maxAttempts; i++) {
    if (bridgeConnected) return true;
    connectBridge();
    await new Promise(r => setTimeout(r, 800));
  }
  return bridgeConnected;
}

async function autoSetup(provider) {
  const steps = [];

  const connected = await ensureBridgeConnected();
  steps.push({ step: 'bridge', ok: connected });
  if (!connected) {
    return { ok: false, steps, error: 'Bridge offline — run start-bridge.bat first' };
  }

  let projects = [];
  try {
    const result = await callTool('list_projects');
    projects = result?.data?.projects || [];
    steps.push({ step: 'list_projects', ok: true, count: projects.length });
  } catch (e) {
    steps.push({ step: 'list_projects', ok: false });
  }

  let activeProject = projects[0];
  if (!activeProject) {
    try {
      const created = await callTool('create_project', { name: 'My Build', type: 'web' });
      activeProject = created?.data;
      steps.push({ step: 'create_project', ok: true, projectId: activeProject?.id });
    } catch (e) {
      steps.push({ step: 'create_project', ok: false });
    }
  }

  if (activeProject?.id) {
    await chrome.storage.local.set({
      activeProjectId: activeProject.id,
      activeProjectName: activeProject.name || activeProject.id
    });
    steps.push({ step: 'active_project', ok: true, projectId: activeProject.id });
  }

  aiState[provider].active = true;
  aiState[provider].loggedIn = true;
  broadcastStatus();

  return { ok: true, steps, activeProject };
}

async function startBuilding(provider, autoSetupEnabled = true) {
  connectBridge();
  const connected = await ensureBridgeConnected();

  let setupResult = null;
  if (autoSetupEnabled && connected) {
    setupResult = await autoSetup(provider);
  }

  if (!connected) {
    throw new Error('Bridge offline — run start-bridge.bat first');
  }

  const tools = await chrome.storage.local.get('bridgeTools');
  const toolList = (tools.bridgeTools || [])
    .map(t => `- ${t.name}: ${t.description}`)
    .join('\n');

  const activeId = setupResult?.activeProject?.id || '';
  const previewUrl = activeId ? `${previewBase}/play/${activeId}/` : previewBase;

  const setupPrompt = buildSetupPrompt(provider, toolList, activeId, previewUrl);

  await chrome.storage.local.set({
    buildingActive: true,
    activeProvider: provider,
    setupPrompt
  });

  aiState[provider].active = true;
  broadcastStatus();

  return {
    ok: true,
    setupPrompt,
    autoSetup: setupResult,
    previewUrl,
    message: 'Start Building activated with auto-setup complete.'
  };
}

function buildSetupPrompt(provider, toolList, projectId, previewUrl) {
  return `You are NovaBuild AI — a top-tier builder assistant connected to my local NovaBuild bridge.

When I say "start building", greet me warmly like: "What game, website, or app do you want me to build today, boss?"

You have these tools (request them via NovaBuild):
${toolList}

Active project: ${projectId || 'none yet — use create_project'}
Live preview (play before publish): ${previewUrl}

Rules:
1. Always ask what to build if unclear
2. Use create_project for new builds (type: web or game)
3. Use write_file to edit HTML/CSS/JS — changes appear instantly in preview
4. Use run_preview to get the play URL before publishing
5. Use publish_project for local preview links
6. Use publish_github_pages for Roblox-safe github.io links (Roblox blocks unknown domains)
7. Use get_project_structure to see the code architecture
8. Be creative, modern, and production-quality

I'm connected via ${provider}. Let's build something amazing.`;
}

async function captureActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs[0]?.windowId) throw new Error('No active tab');
  const dataUrl = await chrome.tabs.captureVisibleTab(tabs[0].windowId, { format: 'png' });
  return { screenshot: dataUrl };
}

connectBridge();
