const els = {
  banner: document.getElementById('banner'),
  toggleSave: document.getElementById('toggleSave'),
  logoutBtn: document.getElementById('logoutBtn'),
  saveForm: document.getElementById('saveForm'),
  nameInput: document.getElementById('nameInput'),
  emailInput: document.getElementById('emailInput'),
  saveBtn: document.getElementById('saveBtn'),
  cancelSave: document.getElementById('cancelSave'),
  accountsToggle: document.getElementById('accountsToggle'),
  accountsCount: document.getElementById('accountsCount'),
  accountList: document.getElementById('accountList'),
  refreshState: document.getElementById('refreshState'),
  subhead: document.getElementById('subhead'),
  syncStatus: document.getElementById('syncStatus'),
  dropboxName: document.getElementById('dropboxName'),
  syncButtons: document.getElementById('syncButtons'),
  pushCloudBtn: document.getElementById('pushCloudBtn'),
  pullCloudBtn: document.getElementById('pullCloudBtn'),
  openSyncPageBtn: document.getElementById('openSyncPageBtn'),
  confirmDialog: document.getElementById('confirmDialog'),
  confirmMsg: document.getElementById('confirmMsg'),
  confirmYes: document.getElementById('confirmYes'),
  confirmNo: document.getElementById('confirmNo'),
  trackerToggle: document.getElementById('trackerToggle'),
  template: document.getElementById('accountRowTemplate')
};

const SETTINGS_KEY = 'cas_ext_settings';

let state = {
  accounts: [],
  activeId: null,
  hasClaudeTab: false,
  activeClaudeUrl: null,
  dropboxConnected: false,
  dropboxDisplayName: null,
  syncStatus: null
};

init();

async function init() {
  try {
    bindEvents();
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'local' && Object.keys(changes).some((key) => key.startsWith('cas_ext_'))) {
        reloadState();
      }
    });
    await reloadState();
    await loadSettings();
  } catch (error) {
    console.error('[CAS popup init]', error);
    showBanner(error?.message || String(error));
  }
}

async function loadSettings() {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  const settings = stored[SETTINGS_KEY] || {};
  els.trackerToggle.checked = settings.inlineTrackerEnabled !== false;
}

function bindEvents() {
  els.toggleSave.addEventListener('click', () => {
    els.saveForm.classList.toggle('hidden');
    if (!els.saveForm.classList.contains('hidden')) {
      els.nameInput.focus();
    }
  });

  els.cancelSave.addEventListener('click', () => {
    els.saveForm.classList.add('hidden');
    els.nameInput.value = '';
    els.emailInput.value = '';
  });

  els.saveForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    await withBusy(els.saveBtn, async () => {
      const result = await send('cas:saveCurrent', {
        name: els.nameInput.value,
        email: els.emailInput.value
      });
      if (!result.ok) {
        showBanner(result.error || 'Save failed.');
        return;
      }
      els.nameInput.value = '';
      els.emailInput.value = '';
      els.saveForm.classList.add('hidden');
      await reloadState('Saved. Not magic, just cookies and storage done properly.');
    });
  });

  els.refreshState.addEventListener('click', async () => {
    await reloadState();
  });

  els.logoutBtn.addEventListener('click', async () => {
    await withBusy(els.logoutBtn, async () => {
      const result = await send('cas:logout');
      if (!result.ok) {
        showBanner(result.error || 'Logout failed.');
        return;
      }
      await reloadState('Claude cookies cleared and tab refreshed.');
    });
  });

  els.accountsToggle.addEventListener('click', () => {
    const expanded = els.accountsToggle.getAttribute('aria-expanded') === 'true';
    els.accountsToggle.setAttribute('aria-expanded', String(!expanded));
    els.accountList.classList.toggle('hidden', expanded);
  });

  els.pushCloudBtn.addEventListener('click', async () => {
    const ok = await showConfirm('Overwrite the Dropbox backup with your current local accounts?');
    if (!ok) return;
    await withBusy(els.pushCloudBtn, async () => {
      const result = await send('cas:pushDropbox');
      if (!result.ok) { showBanner(result.error || 'Push failed.'); return; }
      await reloadState('Pushed to Dropbox.');
    });
  });

  els.pullCloudBtn.addEventListener('click', async () => {
    const ok = await showConfirm('Overwrite your local accounts with the Dropbox backup?');
    if (!ok) return;
    await withBusy(els.pullCloudBtn, async () => {
      const result = await send('cas:pullDropbox');
      if (!result.ok) { showBanner(result.error || 'Pull failed.'); return; }
      await reloadState('Pulled from Dropbox.');
    });
  });

  els.trackerToggle.addEventListener('change', async () => {
    const stored = await chrome.storage.local.get(SETTINGS_KEY);
    const settings = stored[SETTINGS_KEY] || {};
    settings.inlineTrackerEnabled = els.trackerToggle.checked;
    await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
  });

  els.openSyncPageBtn.addEventListener('click', async () => {
    await chrome.tabs.create({ url: chrome.runtime.getURL('sync.html') });
    window.close();
  });
}

async function reloadState(message) {
  const result = await send('cas:getState');
  if (!result.ok) {
    showBanner(result.error || 'Could not load extension state.');
    return;
  }

  state = {
    accounts: result.accounts || [],
    activeId: result.activeId || null,
    hasClaudeTab: Boolean(result.hasClaudeTab),
    activeClaudeUrl: result.activeClaudeUrl || null,
    dropboxConnected: Boolean(result.dropboxConnected),
    dropboxDisplayName: result.dropboxDisplayName || null,
    syncStatus: result.syncStatus || null
  };

  els.subhead.textContent = getSubheadText();

  if (message) {
    showBanner(message, false);
  } else if (state.syncStatus?.message) {
    showBanner(state.syncStatus.message, !state.syncStatus.ok);
  } else if (!state.hasClaudeTab) {
    showBanner('No Claude tab detected right now. Saving needs a logged-in Claude tab. Switching can open one automatically.', false);
  } else {
    hideBanner();
  }

  renderSyncState();
  renderAccounts();
}

function getSubheadText() {
  if (!state.hasClaudeTab || !state.activeClaudeUrl) {
    return 'Open a Claude tab first, or the extension will open one for switching.';
  }

  try {
    return `Ready on ${new URL(state.activeClaudeUrl).hostname}`;
  } catch {
    return 'Claude tab detected and ready.';
  }
}

function renderSyncState() {
  els.syncStatus.textContent = state.dropboxConnected ? 'Connected to Dropbox.' : 'Not connected. Open Settings to connect.';
  els.dropboxName.textContent = state.dropboxDisplayName || '';
  els.dropboxName.classList.toggle('hidden', !state.dropboxDisplayName);
  els.pushCloudBtn.disabled = !state.dropboxConnected;
  els.pullCloudBtn.disabled = !state.dropboxConnected;
}

function renderAccounts() {
  els.accountList.innerHTML = '';
  els.accountsCount.textContent = state.accounts.length ? `(${state.accounts.length})` : '';

  if (!state.accounts.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'No saved accounts yet. Log into Claude in a tab, then save a snapshot here.';
    els.accountList.appendChild(empty);
    return;
  }

  for (const account of state.accounts) {
    const node = els.template.content.firstElementChild.cloneNode(true);
    const avatar = node.querySelector('.avatar');
    const name = node.querySelector('.name');
    const pill = node.querySelector('.pill');
    const sub = node.querySelector('.sub');
    const meta = node.querySelector('.meta');
    const switchBtn = node.querySelector('.switchBtn');
    const refreshBtn = node.querySelector('.refreshBtn');
    const renameBtn = node.querySelector('.renameBtn');
    const deleteBtn = node.querySelector('.deleteBtn');

    name.textContent = account.name || 'Unnamed';
    sub.textContent = account.email || 'No email saved';
    meta.textContent = `${relativeTime(account.savedAt)} · ${formatSummary(account)}`;

    const initials = makeInitials(account.name || 'A');
    avatar.textContent = initials;
    avatar.style.background = avatarColor(account.id);

    if (account.id === state.activeId) {
      pill.classList.remove('hidden');
    }

    switchBtn.addEventListener('click', async () => {
      await withBusy(switchBtn, async () => {
        const result = await send('cas:switch', { id: account.id });
        if (!result.ok) {
          showBanner(result.error || 'Switch failed.');
          return;
        }
        await reloadState(`Switched to ${account.name}. If Claude still acts weird, re-save that account once while logged in.`);
        window.close();
      });
    });

    refreshBtn.addEventListener('click', async () => {
      await withBusy(refreshBtn, async () => {
        const result = await send('cas:refresh', { id: account.id });
        if (!result.ok) {
          showBanner(result.error || 'Re-save failed.');
          return;
        }
        await reloadState(`Re-saved ${account.name}.`);
      });
    });

    renameBtn.addEventListener('click', async () => {
      const nextName = window.prompt('Rename account', account.name || '');
      if (nextName == null) return;
      const nextEmail = window.prompt('Email (optional)', account.email || '');
      if (nextEmail == null) return;
      const result = await send('cas:rename', { id: account.id, name: nextName, email: nextEmail });
      if (!result.ok) {
        showBanner(result.error || 'Rename failed.');
        return;
      }
      await reloadState(`Updated ${nextName || account.name}.`);
    });

    deleteBtn.addEventListener('click', async () => {
      if (!window.confirm(`Delete ${account.name}?`)) return;
      const result = await send('cas:remove', { id: account.id });
      if (!result.ok) {
        showBanner(result.error || 'Delete failed.');
        return;
      }
      await reloadState(`Deleted ${account.name}.`);
    });

    els.accountList.appendChild(node);
  }
}

function formatSummary(account) {
  const cookieCount = account?.meta?.cookieSummary?.count ?? 0;
  const lsCount = account?.meta?.storageSummary?.localStorageKeys ?? 0;
  const dbCount = account?.meta?.storageSummary?.indexedDBDatabases ?? 0;
  return `${cookieCount} cookies · ${lsCount} LS keys · ${dbCount} IDB DBs`;
}

function showBanner(message, isError = true) {
  els.banner.textContent = message;
  els.banner.classList.remove('hidden');
  els.banner.style.borderColor = isError ? 'rgba(217,85,85,0.35)' : 'rgba(63,191,127,0.35)';
  els.banner.style.background = isError ? 'rgba(217,85,85,0.12)' : 'rgba(63,191,127,0.12)';
  els.banner.style.color = isError ? '#ffd0d0' : '#c8ffd8';
}

function hideBanner() {
  els.banner.classList.add('hidden');
}

function makeInitials(name) {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'A';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function avatarColor(seed) {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = ((hash << 5) - hash) + seed.charCodeAt(i);
    hash |= 0;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} 48% 38%)`;
}

function relativeTime(timestamp) {
  if (!timestamp) return 'unknown time';
  const diff = Date.now() - timestamp;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

function showConfirm(message) {
  return new Promise((resolve) => {
    els.confirmMsg.textContent = message;
    els.syncButtons.classList.add('hidden');
    els.confirmDialog.classList.remove('hidden');

    const finish = (result) => {
      els.confirmDialog.classList.add('hidden');
      els.syncButtons.classList.remove('hidden');
      resolve(result);
    };

    const onYes = () => { cleanup(); finish(true); };
    const onNo = () => { cleanup(); finish(false); };
    const cleanup = () => {
      els.confirmYes.removeEventListener('click', onYes);
      els.confirmNo.removeEventListener('click', onNo);
    };

    els.confirmYes.addEventListener('click', onYes);
    els.confirmNo.addEventListener('click', onNo);
  });
}

async function withBusy(element, fn) {
  const oldText = element.textContent;
  element.classList.add('loading');
  try {
    await fn();
  } finally {
    element.classList.remove('loading');
    element.textContent = oldText;
  }
}

async function send(type, payload = {}) {
  try {
    return await chrome.runtime.sendMessage({
      type,
      ...(type === 'cas:switch' || type === 'cas:remove' || type === 'cas:refresh'
        ? { id: payload.id }
        : type === 'cas:rename'
          ? { id: payload.id, payload: { name: payload.name, email: payload.email } }
          : { payload })
    });
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }
}
