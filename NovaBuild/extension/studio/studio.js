let previewBase = 'http://127.0.0.1:17614';
let activeProjectId = '';

async function tool(name, args = {}) {
  return chrome.runtime.sendMessage({ type: 'call_tool', tool: name, args });
}

async function refreshBridgeBadge() {
  const status = await chrome.runtime.sendMessage({ type: 'get_status' });
  const badge = document.getElementById('bridge-badge');
  if (status.previewBase) previewBase = status.previewBase;
  if (status.bridgeConnected) {
    badge.textContent = 'Bridge Online';
    badge.className = 'badge online';
  } else {
    badge.textContent = 'Bridge Offline';
    badge.className = 'badge offline pulse';
  }
}

function populateSelects(projects) {
  const selects = [
    'publish-project', 'gh-project', 'preview-project', 'architect-project'
  ];
  selects.forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    sel.innerHTML = projects.map(p =>
      `<option value="${p.id}">${p.name || p.id}</option>`
    ).join('') || '<option value="">No projects</option>';
  });
}

async function loadProjects() {
  const result = await tool('list_projects');
  const projects = result?.data?.projects || [];
  const list = document.getElementById('project-list');
  list.innerHTML = projects.map(p => `
    <li data-id="${p.id}" class="${p.id === activeProjectId ? 'selected' : ''}">
      <strong>${p.name || p.id}</strong>
      <span>${p.type || 'web'} · ${p.id}</span>
    </li>
  `).join('') || '<li>No projects yet — create one above.</li>';

  list.querySelectorAll('li[data-id]').forEach(li => {
    li.addEventListener('click', () => {
      activeProjectId = li.dataset.id;
      loadProjects();
      playPreview(activeProjectId);
      switchTab('preview');
    });
  });

  populateSelects(projects);

  const stored = await chrome.storage.local.get(['activeProjectId']);
  if (stored.activeProjectId && !activeProjectId) {
    activeProjectId = stored.activeProjectId;
    const previewSel = document.getElementById('preview-project');
    if (previewSel) previewSel.value = activeProjectId;
  }
}

function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === name);
  });
  document.querySelectorAll('.tab-panel').forEach(p => {
    p.classList.toggle('active', p.id === 'tab-' + name);
  });
}

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => switchTab(tab.dataset.tab));
});

function playPreview(projectId) {
  if (!projectId) {
    projectId = document.getElementById('preview-project')?.value;
  }
  if (!projectId) return;

  activeProjectId = projectId;
  const url = `${previewBase}/play/${projectId}/`;
  const frame = document.getElementById('preview-frame');
  const placeholder = document.getElementById('preview-placeholder');

  frame.src = url;
  frame.classList.add('active');
  placeholder.classList.add('hidden');
}

async function loadFileTree(projectId) {
  const tree = document.getElementById('file-tree');
  if (!projectId) {
    tree.innerHTML = '<li>Select a project</li>';
    return;
  }
  try {
    const result = await tool('get_project_structure', { projectId });
    const files = result?.data?.files || [];
    const icons = { html: '📄', css: '🎨', javascript: '⚡', json: '📋', asset: '🖼️', file: '📁' };
    tree.innerHTML = files.map(f => `
      <li data-path="${f.path}" data-project="${projectId}">
        <span class="file-icon">${icons[f.type] || '📁'}</span>
        ${f.path}
      </li>
    `).join('') || '<li>No files</li>';

    tree.querySelectorAll('li[data-path]').forEach(li => {
      li.addEventListener('click', async () => {
        tree.querySelectorAll('li').forEach(x => x.classList.remove('active'));
        li.classList.add('active');
        const res = await tool('read_file', { projectId, path: li.dataset.path });
        document.getElementById('architect-file-label').textContent = li.dataset.path;
        document.getElementById('code-view').textContent = res?.data?.content || '';
      });
    });
  } catch (e) {
    tree.innerHTML = '<li>Could not load files</li>';
  }
}

async function loadActivityFeed() {
  const stored = await chrome.storage.local.get('codeArchitect');
  const log = stored.codeArchitect || [];
  const feed = document.getElementById('activity-feed');

  feed.innerHTML = log.slice(0, 8).map(entry => `
    <div class="activity-item">
      <strong>${entry.tool}</strong> → ${entry.path || entry.projectId || 'project'}
      <span style="float:right">${new Date(entry.timestamp).toLocaleTimeString()}</span>
    </div>
  `).join('') || '<div class="activity-item">No AI activity yet — start building!</div>';

  if (log[0]?.code) {
    document.getElementById('code-view').textContent = log[0].code;
    document.getElementById('architect-file-label').textContent = log[0].path || 'latest change';
    document.getElementById('architect-tool-label').textContent = log[0].tool;
  }
}

document.getElementById('create-project').addEventListener('click', async () => {
  const name = document.getElementById('project-name').value || 'My Project';
  const type = document.getElementById('project-type').value;
  try {
    const result = await tool('create_project', { name, type });
    activeProjectId = result?.data?.id;
    await chrome.storage.local.set({ activeProjectId });
    await loadProjects();
    document.getElementById('project-name').value = '';
    playPreview(activeProjectId);
    switchTab('preview');
  } catch (e) {
    alert(e.message || 'Failed — is the bridge running?');
  }
});

document.getElementById('play-btn').addEventListener('click', () => {
  playPreview(document.getElementById('preview-project').value);
});

document.getElementById('refresh-preview').addEventListener('click', () => {
  const frame = document.getElementById('preview-frame');
  frame.src = frame.src;
});

document.getElementById('publish-btn').addEventListener('click', async () => {
  const projectId = document.getElementById('publish-project').value;
  const slug = document.getElementById('publish-slug').value;
  try {
    const result = await tool('publish_project', { projectId, slug });
    const data = result?.data || {};
    document.getElementById('publish-result').innerHTML = `
      <strong>Published locally!</strong><br>
      Play: <a href="${data.playUrl}" target="_blank">${data.playUrl}</a><br>
      Preview: <a href="${data.previewUrl}" target="_blank">${data.previewUrl}</a><br>
      ${data.robloxSafeUrl ? `Roblox link (after GitHub deploy): <a href="${data.robloxSafeUrl}" target="_blank">${data.robloxSafeUrl}</a><br>` : ''}
      <em>${data.robloxNote || ''}</em>
    `;
  } catch (e) {
    document.getElementById('publish-result').textContent = e.message;
  }
});

document.getElementById('publish-roblox-btn').addEventListener('click', async () => {
  const projectId = document.getElementById('publish-project').value;
  const slug = document.getElementById('publish-slug').value;
  const resultBox = document.getElementById('publish-result');
  resultBox.textContent = 'Deploying to GitHub Pages...';
  try {
    const result = await tool('publish_github_pages', { projectId, slug });
    const data = result?.data || {};
    resultBox.innerHTML = `
      <strong>Roblox-safe link ready!</strong><br>
      <a href="${data.robloxSafeUrl}" target="_blank">${data.robloxSafeUrl}</a><br>
      <em>${data.note || ''}</em>
    `;
  } catch (e) {
    resultBox.textContent = e.message + ' — Connect GitHub first in the GitHub tab.';
  }
});

document.getElementById('gh-connect').addEventListener('click', async () => {
  const username = document.getElementById('gh-username').value;
  const token = document.getElementById('gh-token').value;
  try {
    await tool('github_connect', { username, token });
    document.getElementById('gh-status').textContent = 'GitHub connected as ' + username;
  } catch (e) {
    document.getElementById('gh-status').textContent = e.message;
  }
});

document.getElementById('gh-push').addEventListener('click', async () => {
  const projectId = document.getElementById('gh-project').value;
  const repo = document.getElementById('gh-repo').value;
  try {
    const result = await tool('github_push', { projectId, repo, commitMessage: 'NovaBuild publish' });
    const data = result.data || {};
    document.getElementById('gh-status').innerHTML =
      `Pushed to <a href="${data.url}" target="_blank">${data.repo}</a><br>
       Roblox-safe: <a href="${data.robloxSafeUrl}" target="_blank">${data.robloxSafeUrl}</a>`;
  } catch (e) {
    document.getElementById('gh-status').textContent = e.message;
  }
});

document.getElementById('capture-btn').addEventListener('click', async () => {
  const result = await chrome.runtime.sendMessage({ type: 'capture_tab' });
  if (result?.screenshot) {
    const img = document.getElementById('preview-img');
    img.src = result.screenshot;
    img.classList.remove('hidden');
    await chrome.storage.local.set({ lastCapture: result.screenshot });
  }
});

document.getElementById('architect-project').addEventListener('change', (e) => {
  loadFileTree(e.target.value);
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes.codeArchitect) loadActivityFeed();
});

chrome.storage.local.get('lastCapture', data => {
  if (data.lastCapture) {
    const img = document.getElementById('preview-img');
    img.src = data.lastCapture;
    img.classList.remove('hidden');
  }
});

refreshBridgeBadge();
loadProjects().catch(() => {});
loadActivityFeed();
setInterval(refreshBridgeBadge, 3000);
setInterval(loadActivityFeed, 4000);

document.getElementById('architect-project').addEventListener('change', (e) => {
  if (e.target.value) loadFileTree(e.target.value);
});

chrome.storage.local.get('activeProjectId').then(data => {
  if (data.activeProjectId) {
    activeProjectId = data.activeProjectId;
    const archSel = document.getElementById('architect-project');
    if (archSel) {
      archSel.value = activeProjectId;
      loadFileTree(activeProjectId);
    }
  }
});
