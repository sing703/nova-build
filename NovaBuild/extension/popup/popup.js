const PROVIDER_URLS = {
  deepseek: 'https://chat.deepseek.com',
  chatgpt: 'https://chatgpt.com',
  arena: 'https://arena.ai'
};

function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 4000);
}

async function send(type, data = {}) {
  return chrome.runtime.sendMessage({ type, ...data });
}

async function refreshStatus() {
  const status = await send('get_status');
  const dot = document.getElementById('bridge-dot');
  const bridgeStatus = document.getElementById('bridge-status');

  if (status.bridgeConnected) {
    dot.className = 'dot online';
    bridgeStatus.textContent = 'Online';
  } else {
    dot.className = 'dot offline';
    bridgeStatus.textContent = 'Offline';
  }

  for (const [provider, state] of Object.entries(status.aiState || {})) {
    const card = document.querySelector(`.ai-card[data-provider="${provider}"]`);
    if (!card) continue;
    const label = card.querySelector('.ai-status');
    if (state.active && state.loggedIn) {
      card.classList.add('connected');
      label.textContent = 'Connected & ready';
    } else if (state.loggedIn) {
      label.textContent = 'Logged in — click Connect';
    } else {
      card.classList.remove('connected');
      label.textContent = 'Not connected';
    }
  }
}

document.getElementById('start-bridge-help').addEventListener('click', () => {
  toast('Double-click start-bridge.bat in the NovaBuild folder.');
});

document.querySelectorAll('.btn-open').forEach(btn => {
  btn.addEventListener('click', () => {
    chrome.tabs.create({ url: btn.dataset.url });
  });
});

document.querySelectorAll('.btn-connect').forEach(btn => {
  btn.addEventListener('click', async () => {
    const card = btn.closest('.ai-card');
    const provider = card.dataset.provider;
    const url = PROVIDER_URLS[provider];

    const tabs = await chrome.tabs.query({ url: url + '/*' });
    if (tabs.length === 0) {
      await chrome.tabs.create({ url });
      toast('Complete login on the AI site, then click Connect again.');
      return;
    }

    await chrome.tabs.update(tabs[0].id, { active: true });
    await send('set_ai_active', { provider, active: true, loggedIn: true });
    toast(`${provider} connected! Click Start Building when ready.`);
    refreshStatus();
  });
});

document.getElementById('setup-btn').addEventListener('click', async () => {
  const provider = document.getElementById('active-provider').value;

  await send('connect_bridge');
  if (!(await send('get_status')).bridgeConnected) {
    toast('Start the bridge first (start-bridge.bat)');
    return;
  }

  const result = await send('start_building', { provider, autoSetup: true });
  await navigator.clipboard.writeText(result.setupPrompt);
  toast('Auto-setup done! Prompt copied — paste into AI chat.');

  const url = PROVIDER_URLS[provider];
  const tabs = await chrome.tabs.query({ url: url + '/*' });
  if (tabs[0]) {
    chrome.tabs.sendMessage(tabs[0].id, {
      type: 'novabuild_setup',
      setupPrompt: result.setupPrompt
    }).catch(() => {});
  }
});

document.getElementById('start-building-btn').addEventListener('click', async () => {
  const provider = document.getElementById('active-provider').value;

  await send('connect_bridge');
  const status = await send('get_status');

  if (!status.bridgeConnected) {
    toast('Bridge offline — run start-bridge.bat first!');
    return;
  }

  const result = await send('start_building', { provider, autoSetup: true });
  toast('Auto-setup complete! Building mode ON.');

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await send('open_studio', { windowId: tab.windowId });

  const url = PROVIDER_URLS[provider];
  const tabs = await chrome.tabs.query({ url: url + '/*' });
  if (tabs[0]) {
    chrome.tabs.update(tabs[0].id, { active: true });
    chrome.tabs.sendMessage(tabs[0].id, {
      type: 'novabuild_start',
      greeting: 'What game, website, or app do you want me to build today, boss?'
    }).catch(() => {});
  }
});

document.getElementById('open-studio').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await send('open_studio', { windowId: tab.windowId });
});

refreshStatus();
setInterval(refreshStatus, 2000);
send('connect_bridge');
