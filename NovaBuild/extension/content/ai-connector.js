(function () {
  'use strict';

  const PROVIDER = detectProvider();
  if (!PROVIDER) return;

  let panel = null;
  let buildingActive = false;
  let previewBase = 'http://127.0.0.1:17614';

  const PANEL_KEY = 'novabuild_panel_state';

  function detectProvider() {
    const host = location.hostname;
    if (host.includes('deepseek')) return 'deepseek';
    if (host.includes('openai') || host.includes('chatgpt')) return 'chatgpt';
    if (host.includes('arena')) return 'arena';
    return null;
  }

  function detectLoggedIn() {
    if (PROVIDER === 'deepseek') {
      return !document.querySelector('input[type="password"]') &&
        (document.querySelector('textarea') || document.querySelector('[contenteditable="true"]'));
    }
    if (PROVIDER === 'chatgpt') {
      return !!document.querySelector('#prompt-textarea, textarea[data-id], [contenteditable="true"]');
    }
    if (PROVIDER === 'arena') {
      return !!document.querySelector('textarea, [contenteditable="true"]');
    }
    return false;
  }

  function createPanel() {
    if (panel) return panel;

    panel = document.createElement('div');
    panel.id = 'novabuild-panel';
    panel.innerHTML = `
      <div class="nb-header" id="nb-drag-handle">
        <span class="nb-title">⚡ NovaBuild</span>
        <div class="nb-header-btns">
          <button id="nb-minimize" title="Minimize">−</button>
        </div>
      </div>
      <div class="nb-body">
        <div id="nb-setup-progress" class="nb-setup hidden">
          <div class="nb-setup-step" id="nb-step-bridge">⏳ Connecting bridge...</div>
          <div class="nb-setup-step" id="nb-step-project">⏳ Setting up project...</div>
          <div class="nb-setup-step" id="nb-step-ready">⏳ Preparing AI...</div>
        </div>
        <p id="nb-greeting" class="nb-greeting hidden"></p>
        <p id="nb-status">Waiting for connection...</p>
        <button id="nb-start" class="nb-btn primary pulse-btn">🚀 Start Building</button>
        <button id="nb-preview" class="nb-btn">▶ Play Preview</button>
        <button id="nb-capture" class="nb-btn">📸 Capture</button>
        <button id="nb-architect" class="nb-btn">🏗️ Code Architect</button>
        <div id="nb-code-panel" class="nb-code-panel hidden">
          <div class="nb-code-header">
            <span id="nb-code-file">No file yet</span>
            <span id="nb-code-tool" class="nb-tool-tag"></span>
          </div>
          <pre id="nb-code-content" class="nb-code-content">// AI code changes appear here</pre>
        </div>
      </div>
      <div class="nb-resize-handle" id="nb-resize"></div>
    `;
    document.body.appendChild(panel);

    restorePanelState();
    makeDraggable(panel.querySelector('#nb-drag-handle'), panel);
    makeResizable(panel, panel.querySelector('#nb-resize'));

    panel.querySelector('#nb-minimize').addEventListener('click', () => {
      panel.classList.toggle('minimized');
      savePanelState();
    });

    panel.querySelector('#nb-start').addEventListener('click', onStartBuilding);
    panel.querySelector('#nb-preview').addEventListener('click', onPlayPreview);
    panel.querySelector('#nb-capture').addEventListener('click', onCapture);
    panel.querySelector('#nb-architect').addEventListener('click', onToggleArchitect);

    return panel;
  }

  function savePanelState() {
    const rect = panel.getBoundingClientRect();
    chrome.storage.local.set({
      [PANEL_KEY]: {
        left: panel.style.left,
        top: panel.style.top,
        width: panel.style.width,
        height: panel.style.height,
        minimized: panel.classList.contains('minimized')
      }
    });
  }

  function restorePanelState() {
    chrome.storage.local.get(PANEL_KEY, data => {
      const state = data[PANEL_KEY];
      if (!state) {
        panel.style.right = '20px';
        panel.style.bottom = '20px';
        panel.style.left = 'auto';
        panel.style.top = 'auto';
        return;
      }
      if (state.left) panel.style.left = state.left;
      if (state.top) panel.style.top = state.top;
      if (state.width) panel.style.width = state.width;
      if (state.height) panel.style.height = state.height;
      if (state.minimized) panel.classList.add('minimized');
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
    });
  }

  function makeDraggable(handle, element) {
    let startX, startY, startLeft, startTop;

    handle.addEventListener('mousedown', (e) => {
      if (e.target.tagName === 'BUTTON') return;
      e.preventDefault();
      const rect = element.getBoundingClientRect();
      startX = e.clientX;
      startY = e.clientY;
      startLeft = rect.left;
      startTop = rect.top;
      element.style.right = 'auto';
      element.style.bottom = 'auto';
      element.style.left = startLeft + 'px';
      element.style.top = startTop + 'px';
      element.classList.add('dragging');

      function onMove(ev) {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        element.style.left = Math.max(0, startLeft + dx) + 'px';
        element.style.top = Math.max(0, startTop + dy) + 'px';
      }

      function onUp() {
        element.classList.remove('dragging');
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        savePanelState();
      }

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  function makeResizable(element, handle) {
    let startX, startY, startW, startH;

    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      startX = e.clientX;
      startY = e.clientY;
      startW = element.offsetWidth;
      startH = element.offsetHeight;

      function onMove(ev) {
        const w = Math.max(240, startW + (ev.clientX - startX));
        const h = Math.max(180, startH + (ev.clientY - startY));
        element.style.width = w + 'px';
        element.style.height = h + 'px';
      }

      function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        savePanelState();
      }

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  function setSetupStep(id, done, text) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = (done ? '✅ ' : '⏳ ') + text;
    el.classList.toggle('done', done);
  }

  async function onStartBuilding() {
    buildingActive = true;
    const progress = panel.querySelector('#nb-setup-progress');
    progress.classList.remove('hidden');

    setSetupStep('nb-step-bridge', false, 'Connecting bridge...');
    setSetupStep('nb-step-project', false, 'Setting up project...');
    setSetupStep('nb-step-ready', false, 'Preparing AI...');

    chrome.runtime.sendMessage({ type: 'connect_bridge' });

    chrome.runtime.sendMessage({ type: 'start_building', provider: PROVIDER, autoSetup: true }, async (res) => {
      if (res?.error) {
        setStatus(res.error);
        progress.classList.add('hidden');
        return;
      }

      const steps = res?.autoSetup?.steps || [];
      const bridgeOk = steps.find(s => s.step === 'bridge')?.ok;
      const projectOk = steps.find(s => s.step === 'create_project' || s.step === 'active_project')?.ok;

      setSetupStep('nb-step-bridge', bridgeOk, bridgeOk ? 'Bridge connected' : 'Bridge failed');
      setSetupStep('nb-step-project', projectOk, projectOk ? 'Project ready' : 'Project setup');
      setSetupStep('nb-step-ready', true, 'AI ready!');

      const greeting = 'What game, website, or app do you want me to build today, boss?';
      showGreeting(greeting);

      if (res?.setupPrompt) {
        insertIntoChat(res.setupPrompt);
      }

      if (res?.previewUrl) {
        setStatus(`Building mode ON! Preview: ${res.previewUrl}`);
      } else {
        setStatus('Building mode active!');
      }

      setTimeout(() => progress.classList.add('hidden'), 2000);

      chrome.runtime.sendMessage({ type: 'open_studio', windowId: null }).catch(() => {});
    });
  }

  async function onPlayPreview() {
    const stored = await chrome.storage.local.get(['activeProjectId', 'previewBase']);
    const projectId = stored.activeProjectId;
    const base = stored.previewBase || previewBase;
    if (!projectId) {
      setStatus('No project yet — click Start Building first.');
      return;
    }
    const url = `${base}/play/${projectId}/`;
    window.open(url, '_blank');
    setStatus('Preview opened in new tab!');
  }

  async function onCapture() {
    chrome.runtime.sendMessage({ type: 'capture_tab' }, async (res) => {
      if (res?.screenshot) {
        const note = `[NovaBuild captured preview at ${new Date().toLocaleTimeString()}]`;
        insertIntoChat(note);
        await chrome.storage.local.set({ lastCapture: res.screenshot });
        setStatus('Screenshot captured!');
      }
    });
  }

  function onToggleArchitect() {
    const codePanel = panel.querySelector('#nb-code-panel');
    codePanel.classList.toggle('hidden');
    loadCodeArchitect();
  }

  async function loadCodeArchitect() {
    const stored = await chrome.storage.local.get('codeArchitect');
    const log = stored.codeArchitect || [];
    if (log.length === 0) return;
    const latest = log[0];
    panel.querySelector('#nb-code-file').textContent = latest.path || latest.projectId || 'project';
    panel.querySelector('#nb-code-tool').textContent = latest.tool;
    panel.querySelector('#nb-code-content').textContent = latest.code || '// No code content';
  }

  function showGreeting(text) {
    const el = panel.querySelector('#nb-greeting');
    el.textContent = text;
    el.classList.remove('hidden');
  }

  function setStatus(text) {
    panel.querySelector('#nb-status').textContent = text;
  }

  function insertIntoChat(text) {
    const input = findChatInput();
    if (!input) {
      navigator.clipboard.writeText(text);
      setStatus('Prompt copied — paste into chat manually.');
      return;
    }

    if (input.tagName === 'TEXTAREA' || input.tagName === 'INPUT') {
      input.value = text;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      input.textContent = text;
      input.dispatchEvent(new InputEvent('input', { bubbles: true }));
    }
    setStatus('Setup prompt inserted into chat!');
  }

  function findChatInput() {
    const selectors = [
      'textarea',
      '#prompt-textarea',
      '[contenteditable="true"]',
      '[role="textbox"]'
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.offsetParent !== null) return el;
    }
    return null;
  }

  function updateLoginState() {
    const loggedIn = detectLoggedIn();
    chrome.runtime.sendMessage({
      type: 'set_ai_logged_in',
      provider: PROVIDER,
      loggedIn
    });

    if (!buildingActive) {
      if (loggedIn) {
        setStatus('Logged in — click Start Building');
      } else {
        setStatus('Please log in to ' + PROVIDER + ' first.');
      }
    }
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'novabuild_setup' && msg.setupPrompt) {
      createPanel();
      insertIntoChat(msg.setupPrompt);
    }
    if (msg.type === 'novabuild_start') {
      createPanel();
      onStartBuilding();
    }
    if (msg.type === 'code_activity' && msg.entry) {
      if (panel) {
        const codePanel = panel.querySelector('#nb-code-panel');
        if (!codePanel.classList.contains('hidden')) {
          panel.querySelector('#nb-code-file').textContent = msg.entry.path || msg.entry.projectId;
          panel.querySelector('#nb-code-tool').textContent = msg.entry.tool;
          if (msg.entry.code) {
            panel.querySelector('#nb-code-content').textContent = msg.entry.code;
          }
        }
      }
    }
  });

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.codeArchitect && panel) {
      const codePanel = panel.querySelector('#nb-code-panel');
      if (!codePanel.classList.contains('hidden')) loadCodeArchitect();
    }
  });

  function init() {
    createPanel();
    updateLoginState();
    setInterval(updateLoginState, 5000);

    chrome.runtime.sendMessage({ type: 'connect_bridge' });
    chrome.runtime.sendMessage({ type: 'get_status' }, (status) => {
      if (status?.previewBase) previewBase = status.previewBase;
      if (status?.bridgeConnected) {
        setStatus('Bridge connected — ready to build');
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
