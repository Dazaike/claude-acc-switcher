const els = {
  banner: document.getElementById('banner'),
  syncStatus: document.getElementById('syncStatus'),
  connectDropboxBtn: document.getElementById('connectDropboxBtn'),
  disconnectBtn: document.getElementById('disconnectBtn'),
  connectRow: document.getElementById('connectRow'),
  disconnectRow: document.getElementById('disconnectRow'),
  pushCloudBtn: document.getElementById('pushCloudBtn'),
  pullCloudBtn: document.getElementById('pullCloudBtn'),
  lastSync: document.getElementById('lastSync'),
  refreshState: document.getElementById('refreshState'),
  mergeSyncBtn: document.getElementById('mergeSyncBtn'),
  exportBtn: document.getElementById('exportBtn'),
  importBtn: document.getElementById('importBtn'),
  importReplaceBtn: document.getElementById('importReplaceBtn'),
  importFile: document.getElementById('importFile')
};

let state = {
  dropboxConnected: false,
  syncStatus: null
};

init();

async function init() {
  bindEvents();
  await reloadState();
}

function bindEvents() {
  els.refreshState.addEventListener('click', async () => {
    await reloadState();
  });

  els.connectDropboxBtn.addEventListener('click', async () => {
    await withBusy(els.connectDropboxBtn, async () => {
      const result = await send('cas:dropboxOAuth');
      if (!result.ok) {
        showBanner(result.error || 'Dropbox OAuth failed.');
        return;
      }
      await reloadState('Dropbox connected.');
    });
  });

  els.disconnectBtn.addEventListener('click', async () => {
    if (!window.confirm('Disconnect Dropbox? You will need to reconnect to push or pull.')) return;
    await withBusy(els.disconnectBtn, async () => {
      const result = await send('cas:dropboxDisconnect');
      if (!result.ok) {
        showBanner(result.error || 'Could not disconnect.');
        return;
      }
      await reloadState('Dropbox disconnected.');
    });
  });

  els.pushCloudBtn.addEventListener('click', async () => {
    if (!window.confirm('Overwrite the Dropbox backup with your current local accounts?')) return;
    await withBusy(els.pushCloudBtn, async () => {
      const result = await send('cas:pushDropbox');
      if (!result.ok) {
        showBanner(result.error || 'Push failed.');
        return;
      }
      await reloadState();
    });
  });

  els.pullCloudBtn.addEventListener('click', async () => {
    if (!window.confirm('Overwrite your local accounts with the Dropbox backup?')) return;
    await withBusy(els.pullCloudBtn, async () => {
      const result = await send('cas:pullDropbox');
      if (!result.ok) {
        showBanner(result.error || 'Pull failed.');
        return;
      }
      await reloadState();
    });
  });

  els.mergeSyncBtn.addEventListener('click', async () => {
    await withBusy(els.mergeSyncBtn, async () => {
      const result = await send('cas:syncDropbox');
      if (!result.ok) {
        showBanner(result.error || 'Sync failed.');
        return;
      }
      await reloadState();
    });
  });

  els.exportBtn.addEventListener('click', async () => {
    await withBusy(els.exportBtn, async () => {
      const result = await send('cas:exportData');
      if (!result.ok) {
        showBanner(result.error || 'Export failed.');
        return;
      }
      const blob = new Blob([JSON.stringify(result.data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `claude-accounts-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      showBanner(`Exported ${result.data.accounts.length} account(s).`, false);
    });
  });

  let importMode = 'merge';
  els.importBtn.addEventListener('click', () => { importMode = 'merge'; els.importFile.click(); });
  els.importReplaceBtn.addEventListener('click', () => {
    if (!window.confirm('Replace ALL local accounts with the imported file?')) return;
    importMode = 'replace';
    els.importFile.click();
  });
  els.importFile.addEventListener('change', async () => {
    const file = els.importFile.files[0];
    els.importFile.value = '';
    if (!file) return;
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch {
      showBanner('Selected file is not valid JSON.');
      return;
    }
    const result = await send('cas:importData', { data, mode: importMode });
    if (!result.ok) {
      showBanner(result.error || 'Import failed.');
      return;
    }
    showBanner(
      result.mode === 'replace'
        ? `Replaced local accounts with ${result.count} imported account(s).`
        : `Imported: ${result.added} added, ${result.updated} updated (${result.count} total).`,
      false
    );
  });
}

async function reloadState(message) {
  const result = await send('cas:getState');
  if (!result.ok) {
    showBanner(result.error || 'Could not load extension state.');
    return;
  }

  state = {
    dropboxConnected: Boolean(result.dropboxConnected),
    syncStatus: result.syncStatus || null
  };

  els.syncStatus.textContent = state.dropboxConnected ? 'Connected to Dropbox.' : 'Not connected.';
  els.connectRow.classList.toggle('hidden', state.dropboxConnected);
  els.disconnectRow.classList.toggle('hidden', !state.dropboxConnected);
  els.pushCloudBtn.disabled = !state.dropboxConnected;
  els.pullCloudBtn.disabled = !state.dropboxConnected;
  els.mergeSyncBtn.disabled = !state.dropboxConnected;
  els.lastSync.textContent = formatSyncStatus(state.syncStatus);

  if (message) {
    showBanner(message, false);
  } else if (state.syncStatus?.message) {
    showBanner(state.syncStatus.message, !state.syncStatus.ok);
  } else {
    hideBanner();
  }
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

function formatSyncStatus(syncStatus) {
  if (!syncStatus?.at) {
    return 'No sync has run yet.';
  }
  const action = { pull: 'Pull', sync: 'Merge sync' }[syncStatus.type] || 'Push';
  const outcome = syncStatus.ok ? 'succeeded' : 'failed';
  const time = new Date(syncStatus.at).toLocaleString();
  return `${action} ${outcome} on ${time}.`;
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
    return await chrome.runtime.sendMessage({ type, payload });
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }
}
