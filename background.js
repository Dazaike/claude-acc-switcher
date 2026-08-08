const STORAGE_KEYS = {
  accounts: 'cas_ext_accounts_v1',
  activeId: 'cas_ext_active_id_v1',
  dropboxToken: 'cas_ext_dropbox_token_v1',      // legacy — cleared on OAuth connect
  dropboxAccessToken: 'cas_ext_dropbox_at_v1',
  dropboxRefreshToken: 'cas_ext_dropbox_rt_v1',
  dropboxTokenExpiry: 'cas_ext_dropbox_exp_v1',
  dropboxDisplayName: 'cas_ext_dropbox_name_v1',
  syncStatus: 'cas_ext_sync_status_v1'
};

const CLAUDE_URL = 'https://claude.ai/new';
const CLAUDE_HOST_RE = /(^|\.)claude\.ai$/i;
const AUTH_COOKIE_RE = /^(?:__client|__session|__clerk.*|clerk.*)$/i;
const DROPBOX_BACKUP_PATH = '/accounts.json';
const DROPBOX_APP_KEY = 'xvefoo48c9yivl6';

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    switch (message?.type) {
      case 'cas:getState':
        sendResponse(await getState());
        return;
      case 'cas:saveCurrent':
        sendResponse(await saveCurrentAccount(message.payload || {}));
        return;
      case 'cas:switch':
        sendResponse(await switchAccount(String(message.id || '')));
        return;
      case 'cas:remove':
        sendResponse(await removeAccount(String(message.id || '')));
        return;
      case 'cas:rename':
        sendResponse(await renameAccount(String(message.id || ''), message.payload || {}));
        return;
      case 'cas:reorder':
        sendResponse(await reorderAccounts(message.payload || {}));
        return;
      case 'cas:refresh':
        sendResponse(await refreshAccount(String(message.id || '')));
        return;
      case 'cas:logout':
        sendResponse(await logoutClaude());
        return;
      case 'cas:dropboxOAuth':
        sendResponse(await startDropboxOAuth());
        return;
      case 'cas:dropboxDisconnect':
        sendResponse(await disconnectDropbox());
        return;
      case 'cas:pushDropbox':
        sendResponse(await pushDropboxBackup());
        return;
      case 'cas:pullDropbox':
        sendResponse(await pullDropboxBackup());
        return;
      default:
        sendResponse({ ok: false, error: 'Unknown message type.' });
        return;
    }
  })().catch((error) => {
    sendResponse({ ok: false, error: error?.message || String(error) });
  });

  return true;
});

async function getState() {
  const stored = await chrome.storage.local.get({
    [STORAGE_KEYS.accounts]: [],
    [STORAGE_KEYS.activeId]: null,
    [STORAGE_KEYS.dropboxRefreshToken]: '',
    [STORAGE_KEYS.dropboxDisplayName]: '',
    [STORAGE_KEYS.syncStatus]: null
  });

  const tab = await getBestClaudeTab(false);

  return {
    ok: true,
    accounts: stored[STORAGE_KEYS.accounts] || [],
    activeId: stored[STORAGE_KEYS.activeId] || null,
    dropboxConnected: Boolean(stored[STORAGE_KEYS.dropboxRefreshToken]),
    dropboxDisplayName: stored[STORAGE_KEYS.dropboxDisplayName] || null,
    syncStatus: stored[STORAGE_KEYS.syncStatus] || null,
    hasClaudeTab: Boolean(tab),
    activeClaudeTabId: tab?.id || null,
    activeClaudeUrl: tab?.url || null
  };
}

// --- Dropbox OAuth 2.0 + PKCE ---

function base64UrlEncode(bytes) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function generateCodeVerifier() {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)));
}

async function generateCodeChallenge(verifier) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64UrlEncode(new Uint8Array(hash));
}

async function startDropboxOAuth() {
  const verifier = generateCodeVerifier();
  const challenge = await generateCodeChallenge(verifier);
  const redirectUri = chrome.identity.getRedirectURL();

  const authUrl = new URL('https://www.dropbox.com/oauth2/authorize');
  authUrl.searchParams.set('client_id', DROPBOX_APP_KEY);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('code_challenge', challenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  authUrl.searchParams.set('token_access_type', 'offline');

  const resultUrl = await chrome.identity.launchWebAuthFlow({ url: authUrl.href, interactive: true });
  const code = new URL(resultUrl).searchParams.get('code');
  if (!code) throw new Error('Dropbox OAuth did not return an authorization code.');

  const tokenRes = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: DROPBOX_APP_KEY,
      code_verifier: verifier
    })
  });
  if (!tokenRes.ok) {
    const text = await tokenRes.text().catch(() => '');
    throw new Error(`Dropbox token exchange failed: ${text || tokenRes.status}`);
  }
  const tokens = await tokenRes.json();

  const displayName = await fetchDropboxDisplayName(tokens.access_token);
  await chrome.storage.local.set({
    [STORAGE_KEYS.dropboxAccessToken]: tokens.access_token,
    [STORAGE_KEYS.dropboxRefreshToken]: tokens.refresh_token,
    [STORAGE_KEYS.dropboxTokenExpiry]: Date.now() + (tokens.expires_in ?? 14400) * 1000,
    [STORAGE_KEYS.dropboxDisplayName]: displayName || '',
    [STORAGE_KEYS.dropboxToken]: ''   // clear legacy key
  });
  return { ok: true };
}

async function fetchDropboxDisplayName(accessToken) {
  try {
    const res = await fetch('https://api.dropboxapi.com/2/users/get_current_account', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.name?.display_name || data?.email || null;
  } catch {
    return null;
  }
}

async function refreshDropboxAccessToken() {
  const stored = await chrome.storage.local.get({ [STORAGE_KEYS.dropboxRefreshToken]: '' });
  const rt = stored[STORAGE_KEYS.dropboxRefreshToken];
  if (!rt) throw new Error('Connect Dropbox first — open the sync page.');

  const res = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: rt,
      client_id: DROPBOX_APP_KEY
    })
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Dropbox token refresh failed: ${text || res.status}`);
  }
  const tokens = await res.json();
  const accessToken = tokens.access_token;
  await chrome.storage.local.set({
    [STORAGE_KEYS.dropboxAccessToken]: accessToken,
    [STORAGE_KEYS.dropboxTokenExpiry]: Date.now() + (tokens.expires_in ?? 14400) * 1000
  });
  return accessToken;
}

async function getValidDropboxToken() {
  const stored = await chrome.storage.local.get({
    [STORAGE_KEYS.dropboxAccessToken]: '',
    [STORAGE_KEYS.dropboxRefreshToken]: '',
    [STORAGE_KEYS.dropboxTokenExpiry]: 0
  });
  if (!stored[STORAGE_KEYS.dropboxRefreshToken]) {
    throw new Error('Connect Dropbox first — open the sync page.');
  }
  const expiry = Number(stored[STORAGE_KEYS.dropboxTokenExpiry] || 0);
  if (!stored[STORAGE_KEYS.dropboxAccessToken] || Date.now() >= expiry - 60_000) {
    return refreshDropboxAccessToken();
  }
  return stored[STORAGE_KEYS.dropboxAccessToken];
}

async function disconnectDropbox() {
  await chrome.storage.local.remove([
    STORAGE_KEYS.dropboxAccessToken,
    STORAGE_KEYS.dropboxRefreshToken,
    STORAGE_KEYS.dropboxTokenExpiry,
    STORAGE_KEYS.dropboxDisplayName,
    STORAGE_KEYS.dropboxToken
  ]);
  return { ok: true };
}

async function pushDropboxBackup() {
  try {
    const { accounts, activeId } = await readStore();
    const token = await getValidDropboxToken();
    const payload = {
      version: 1,
      exportedAt: Date.now(),
      activeId,
      accounts
    };

    const response = await fetch('https://content.dropboxapi.com/2/files/upload', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/octet-stream',
        'Dropbox-API-Arg': JSON.stringify({
          path: DROPBOX_BACKUP_PATH,
          mode: 'overwrite',
          autorename: false,
          mute: true,
          strict_conflict: false
        })
      },
      body: JSON.stringify(payload, null, 2)
    });

    await ensureDropboxOk(response, 'Dropbox push failed.');
    const result = { ok: true, count: accounts.length };
    await setSyncStatus({
      type: 'push',
      ok: true,
      message: `Pushed ${accounts.length} account${accounts.length === 1 ? '' : 's'} to Dropbox.`,
      at: Date.now()
    });
    return result;
  } catch (error) {
    await setSyncStatus({
      type: 'push',
      ok: false,
      message: error?.message || String(error),
      at: Date.now()
    });
    throw error;
  }
}

async function pullDropboxBackup() {
  try {
    const token = await getValidDropboxToken();
    const response = await fetch('https://content.dropboxapi.com/2/files/download', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Dropbox-API-Arg': JSON.stringify({ path: DROPBOX_BACKUP_PATH })
      }
    });

    await ensureDropboxOk(response, 'Dropbox pull failed.');
    const payload = await response.json();
    const accounts = Array.isArray(payload?.accounts) ? payload.accounts : null;
    const activeId = payload?.activeId == null ? null : String(payload.activeId);
    if (!accounts) {
      throw new Error('Dropbox backup file is missing the accounts array.');
    }

    await writeStore({ accounts, activeId });
    const result = { ok: true, count: accounts.length, activeId };
    await setSyncStatus({
      type: 'pull',
      ok: true,
      message: `Pulled ${accounts.length} account${accounts.length === 1 ? '' : 's'} from Dropbox.`,
      at: Date.now()
    });
    return result;
  } catch (error) {
    await setSyncStatus({
      type: 'pull',
      ok: false,
      message: error?.message || String(error),
      at: Date.now()
    });
    throw error;
  }
}

async function saveCurrentAccount(payload) {
  const tab = await getBestClaudeTab(true);
  const name = String(payload.name || '').trim();
  const email = String(payload.email || '').trim();

  if (!name) {
    throw new Error('Give the account a name first.');
  }

  await waitForTabComplete(tab.id);

  const [storageResult, metaResult] = await Promise.all([
    execOnTab(tab.id, captureStorageSnapshot),
    execOnTab(tab.id, readPageMeta)
  ]);

  if (!storageResult?.ok) {
    throw new Error(storageResult?.error || 'Could not capture Claude storage.');
  }

  const cookiesResult = await captureRelevantCookies();
  if (!cookiesResult.ok) {
    throw new Error(cookiesResult.error || 'Could not capture Claude cookies.');
  }

  const { accounts, activeId } = await readStore();
  const account = {
    id: uid(),
    name,
    email,
    savedAt: Date.now(),
    meta: {
      pageTitle: metaResult?.title || '',
      pageUrl: metaResult?.url || tab.url || '',
      userAgent: metaResult?.userAgent || '',
      detectedClerkInfo: metaResult?.clerk || null,
      storageSummary: storageResult.summary,
      cookieSummary: cookiesResult.summary
    },
    snapshot: {
      cookies: cookiesResult.snapshot,
      storage: storageResult.snapshot
    }
  };

  const nextAccounts = [...accounts, account];
  await writeStore({ accounts: nextAccounts, activeId: account.id });

  return { ok: true, account, activeId: account.id };
}

async function refreshAccount(id) {
  const tab = await getBestClaudeTab(true);
  await waitForTabComplete(tab.id);

  const { accounts, activeId } = await readStore();
  const index = accounts.findIndex((item) => item.id === id);
  if (index === -1) {
    throw new Error('Saved account not found.');
  }

  const [storageResult, metaResult] = await Promise.all([
    execOnTab(tab.id, captureStorageSnapshot),
    execOnTab(tab.id, readPageMeta)
  ]);

  if (!storageResult?.ok) {
    throw new Error(storageResult?.error || 'Could not capture Claude storage.');
  }

  const cookiesResult = await captureRelevantCookies();
  if (!cookiesResult.ok) {
    throw new Error(cookiesResult.error || 'Could not capture Claude cookies.');
  }

  const updated = {
    ...accounts[index],
    savedAt: Date.now(),
    meta: {
      ...(accounts[index].meta || {}),
      pageTitle: metaResult?.title || accounts[index].meta?.pageTitle || '',
      pageUrl: metaResult?.url || tab.url || '',
      userAgent: metaResult?.userAgent || '',
      detectedClerkInfo: metaResult?.clerk || null,
      storageSummary: storageResult.summary,
      cookieSummary: cookiesResult.summary
    },
    snapshot: {
      cookies: cookiesResult.snapshot,
      storage: storageResult.snapshot
    }
  };

  const nextAccounts = accounts.slice();
  nextAccounts[index] = updated;
  await writeStore({ accounts: nextAccounts, activeId: activeId || updated.id });

  return { ok: true, account: updated };
}

async function renameAccount(id, payload) {
  const name = String(payload.name || '').trim();
  const email = String(payload.email || '').trim();
  if (!name) {
    throw new Error('Name cannot be empty.');
  }

  const { accounts, activeId } = await readStore();
  const nextAccounts = accounts.map((item) => item.id === id ? { ...item, name, email } : item);
  if (nextAccounts.length === accounts.length && !accounts.find((item) => item.id === id)) {
    throw new Error('Saved account not found.');
  }

  await writeStore({ accounts: nextAccounts, activeId });
  return { ok: true };
}

async function removeAccount(id) {
  const { accounts, activeId } = await readStore();
  const nextAccounts = accounts.filter((item) => item.id !== id);
  if (nextAccounts.length === accounts.length) {
    throw new Error('Saved account not found.');
  }

  const nextActiveId = activeId === id ? null : activeId;
  await writeStore({ accounts: nextAccounts, activeId: nextActiveId });
  return { ok: true, activeId: nextActiveId };
}

async function reorderAccounts(payload) {
  const orderedIds = Array.isArray(payload?.orderedIds)
    ? payload.orderedIds.map((id) => String(id || '')).filter(Boolean)
    : null;
  if (!orderedIds?.length) {
    throw new Error('orderedIds required.');
  }

  const { accounts, activeId } = await readStore();
  if (orderedIds.length !== accounts.length) {
    throw new Error('Account list changed; refresh and try again.');
  }
  if (new Set(orderedIds).size !== orderedIds.length) {
    throw new Error('Duplicate account id in order.');
  }

  const byId = new Map(accounts.map((item) => [item.id, item]));
  if (orderedIds.some((id) => !byId.has(id))) {
    throw new Error('Unknown account id in order.');
  }

  const nextAccounts = orderedIds.map((id) => byId.get(id));
  const unchanged = nextAccounts.every((item, index) => item.id === accounts[index].id);
  if (unchanged) {
    return { ok: true, accounts: nextAccounts };
  }

  await writeStore({ accounts: nextAccounts, activeId });
  return { ok: true, accounts: nextAccounts };
}

async function switchAccount(id) {
  const { accounts } = await readStore();
  const target = accounts.find((item) => item.id === id);
  if (!target) {
    throw new Error('Saved account not found.');
  }

  const tab = await getBestClaudeTab(true);
  await waitForTabComplete(tab.id);

  const snapshot = target.snapshot || {};
  if (!snapshot.cookies?.cookies?.length) {
    throw new Error('This saved account has no cookie snapshot. Re-save it while logged in.');
  }

  const restoreResult = await execOnTab(tab.id, restoreStorageSnapshot, [snapshot.storage || null]);
  if (!restoreResult?.ok) {
    throw new Error(restoreResult?.error || 'Could not restore Claude storage snapshot.');
  }

  await replaceRelevantCookies(snapshot.cookies);
  await chrome.storage.local.set({ [STORAGE_KEYS.activeId]: id });
  await chrome.tabs.update(tab.id, { url: CLAUDE_URL });
  await waitForTabComplete(tab.id);

  return { ok: true };
}

async function logoutClaude() {
  const tab = await getBestClaudeTab(false);
  await clearRelevantCookies();
  await chrome.storage.local.set({ [STORAGE_KEYS.activeId]: null });

  if (tab?.id) {
    await chrome.tabs.reload(tab.id);
    await waitForTabComplete(tab.id).catch(() => {});
  }

  return { ok: true, reloadedTab: Boolean(tab?.id) };
}

async function readStore() {
  const values = await chrome.storage.local.get({
    [STORAGE_KEYS.accounts]: [],
    [STORAGE_KEYS.activeId]: null
  });

  return {
    accounts: values[STORAGE_KEYS.accounts] || [],
    activeId: values[STORAGE_KEYS.activeId] || null
  };
}

async function ensureDropboxOk(response, fallbackMessage) {
  if (response.ok) return;
  let details = '';
  try {
    details = await response.text();
  } catch {
    details = '';
  }
  throw new Error(details ? `${fallbackMessage} ${details}` : fallbackMessage);
}


async function setSyncStatus(status) {
  await chrome.storage.local.set({ [STORAGE_KEYS.syncStatus]: status });
}

async function writeStore({ accounts, activeId }) {
  await chrome.storage.local.set({
    [STORAGE_KEYS.accounts]: accounts,
    [STORAGE_KEYS.activeId]: activeId
  });
}

async function getBestClaudeTab(throwIfMissing) {
  const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (isClaudeTab(activeTab)) {
    return activeTab;
  }

  const matches = await chrome.tabs.query({ url: ['https://claude.ai/*', 'https://*.claude.ai/*'] });
  const existing = matches.find((tab) => isClaudeTab(tab));
  if (existing) {
    return existing;
  }

  if (!throwIfMissing) {
    return null;
  }

  const created = await chrome.tabs.create({ url: CLAUDE_URL, active: true });
  return created;
}

function isClaudeTab(tab) {
  if (!tab?.url) return false;
  try {
    const url = new URL(tab.url);
    return CLAUDE_HOST_RE.test(url.hostname);
  } catch {
    return false;
  }
}

async function waitForTabComplete(tabId, timeoutMs = 20000) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (tab?.status === 'complete') return;

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('Claude tab took too long to finish loading.'));
    }, timeoutMs);

    function listener(updatedTabId, changeInfo) {
      if (updatedTabId !== tabId) return;
      if (changeInfo.status === 'complete') {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }

    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function execOnTab(tabId, func, args = []) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func,
    args
  });
  return results?.[0]?.result;
}

async function captureRelevantCookies() {
  const cookies = await chrome.cookies.getAll({});
  const relevant = cookies
    .filter(isRelevantCookie)
    .map(serializeCookie)
    .sort(cookieSort);

  return {
    ok: true,
    snapshot: {
      cookies: relevant,
      domains: [...new Set(relevant.map((cookie) => normalizeDomain(cookie.domain)))],
      capturedAt: Date.now()
    },
    summary: {
      count: relevant.length,
      domains: [...new Set(relevant.map((cookie) => normalizeDomain(cookie.domain)))]
    }
  };
}

async function replaceRelevantCookies(snapshot) {
  const savedCookies = Array.isArray(snapshot?.cookies) ? snapshot.cookies.slice().sort(cookieSort) : [];
  const domainsToClear = new Set((snapshot?.domains || []).map(normalizeDomain));

  await clearRelevantCookies((cookie) => {
    const cookieDomain = normalizeDomain(cookie.domain);
    return domainsToClear.size === 0
      || domainsToClear.has(cookieDomain)
      || cookieDomain.endsWith('.claude.ai')
      || cookieDomain === 'claude.ai';
  });

  for (const cookie of savedCookies) {
    await setCookie(cookie).catch(() => {});
  }
}

async function clearRelevantCookies(filterFn = () => true) {
  const currentCookies = await chrome.cookies.getAll({});
  for (const cookie of currentCookies) {
    if (!isRelevantCookie(cookie) || !filterFn(cookie)) continue;
    await removeCookie(cookie).catch(() => {});
  }
}

function isRelevantCookie(cookie) {
  const domain = normalizeDomain(cookie.domain);
  if (domain === 'claude.ai' || domain.endsWith('.claude.ai')) return true;
  if (AUTH_COOKIE_RE.test(cookie.name) && /(claude|clerk|accounts|anthropic)/i.test(domain)) return true;
  return false;
}

function normalizeDomain(domain) {
  return String(domain || '').replace(/^\./, '').toLowerCase();
}

function serializeCookie(cookie) {
  return {
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: cookie.path,
    secure: Boolean(cookie.secure),
    httpOnly: Boolean(cookie.httpOnly),
    sameSite: cookie.sameSite,
    expirationDate: cookie.expirationDate,
    hostOnly: Boolean(cookie.hostOnly),
    session: Boolean(cookie.session),
    storeId: cookie.storeId,
    partitionKey: cookie.partitionKey || null
  };
}

function cookieSort(a, b) {
  const rank = (cookie) => {
    if (cookie.name === '__client') return 0;
    if (cookie.name === '__session') return 1;
    if (/^__clerk/i.test(cookie.name)) return 2;
    if (/^clerk/i.test(cookie.name)) return 3;
    return 10;
  };
  return rank(a) - rank(b);
}

function cookieUrl(cookie) {
  const rawDomain = normalizeDomain(cookie.domain);
  const protocol = cookie.secure ? 'https' : 'http';
  const path = cookie.path || '/';
  return `${protocol}://${rawDomain}${path}`;
}

async function removeCookie(cookie) {
  const details = {
    url: cookieUrl(cookie),
    name: cookie.name,
    storeId: cookie.storeId
  };

  if (cookie.partitionKey) {
    details.partitionKey = cookie.partitionKey;
  }

  await chrome.cookies.remove(details);
}

async function setCookie(cookie) {
  const details = {
    url: cookieUrl(cookie),
    name: cookie.name,
    value: cookie.value,
    path: cookie.path || '/',
    secure: Boolean(cookie.secure),
    httpOnly: Boolean(cookie.httpOnly),
    sameSite: cookie.sameSite,
    storeId: cookie.storeId
  };

  if (!cookie.hostOnly && cookie.domain) {
    details.domain = cookie.domain;
  }

  if (!cookie.session && typeof cookie.expirationDate === 'number') {
    details.expirationDate = cookie.expirationDate;
  }

  if (cookie.partitionKey) {
    details.partitionKey = cookie.partitionKey;
  }

  await chrome.cookies.set(details);
}

function uid() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

async function captureStorageSnapshot() {
  const snapshot = {
    localStorage: {},
    sessionStorage: {},
    indexedDB: [],
    origin: location.origin,
    capturedAt: Date.now()
  };

  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      snapshot.localStorage[key] = localStorage.getItem(key);
    }

    for (let i = 0; i < sessionStorage.length; i += 1) {
      const key = sessionStorage.key(i);
      snapshot.sessionStorage[key] = sessionStorage.getItem(key);
    }

    const dbs = await listDatabases();
    for (const dbInfo of dbs) {
      const dbSnapshot = await snapshotDatabase(dbInfo.name, dbInfo.version);
      if (dbSnapshot) snapshot.indexedDB.push(dbSnapshot);
    }

    return {
      ok: true,
      snapshot,
      summary: {
        localStorageKeys: Object.keys(snapshot.localStorage).length,
        sessionStorageKeys: Object.keys(snapshot.sessionStorage).length,
        indexedDBDatabases: snapshot.indexedDB.length,
        indexedDBStores: snapshot.indexedDB.reduce((sum, db) => sum + db.stores.length, 0)
      }
    };
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }

  async function listDatabases() {
    if (typeof indexedDB.databases === 'function') {
      const raw = await indexedDB.databases();
      return raw
        .filter((db) => db && db.name)
        .map((db) => ({ name: db.name, version: db.version || 1 }));
    }

    return ['clerk-db', 'clerk'].map((name) => ({ name, version: 1 }));
  }

  function snapshotDatabase(name, knownVersion) {
    return new Promise((resolve, reject) => {
      const request = knownVersion ? indexedDB.open(name, knownVersion) : indexedDB.open(name);

      request.onerror = () => reject(request.error || new Error(`Could not open IndexedDB database ${name}.`));
      request.onupgradeneeded = (event) => {
        event.target.transaction.abort();
        resolve(null);
      };
      request.onsuccess = () => {
        const db = request.result;
        const storeNames = Array.from(db.objectStoreNames || []);
        const databaseSnapshot = {
          name,
          version: db.version,
          stores: []
        };

        if (!storeNames.length) {
          db.close();
          resolve(databaseSnapshot);
          return;
        }

        let remaining = storeNames.length;
        for (const storeName of storeNames) {
          try {
            const tx = db.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const storeSnapshot = {
              storeName,
              keyPath: cloneKeyPath(store.keyPath),
              autoIncrement: store.autoIncrement,
              indexes: Array.from(store.indexNames || []).map((indexName) => {
                const index = store.index(indexName);
                return {
                  name: index.name,
                  keyPath: cloneKeyPath(index.keyPath),
                  unique: index.unique,
                  multiEntry: index.multiEntry
                };
              }),
              records: []
            };
            const cursorRequest = store.openCursor();

            cursorRequest.onerror = () => doneStore(storeSnapshot);
            cursorRequest.onsuccess = (event) => {
              const cursor = event.target.result;
              if (!cursor) {
                doneStore(storeSnapshot);
                return;
              }
              storeSnapshot.records.push({ key: cursor.key, value: cursor.value });
              cursor.continue();
            };
          } catch {
            doneStore({
              storeName,
              keyPath: null,
              autoIncrement: false,
              indexes: [],
              records: []
            });
          }
        }

        function doneStore(storeSnapshot) {
          databaseSnapshot.stores.push(storeSnapshot);
          remaining -= 1;
          if (remaining === 0) {
            db.close();
            resolve(databaseSnapshot);
          }
        }
      };
    });
  }

  function cloneKeyPath(keyPath) {
    if (Array.isArray(keyPath)) return keyPath.slice();
    return keyPath == null ? null : keyPath;
  }
}

async function restoreStorageSnapshot(snapshot) {
  try {
    if (!snapshot || typeof snapshot !== 'object') {
      throw new Error('Missing storage snapshot.');
    }

    sessionStorage.clear();
    localStorage.clear();

    for (const [key, value] of Object.entries(snapshot.localStorage || {})) {
      localStorage.setItem(key, value);
    }

    for (const [key, value] of Object.entries(snapshot.sessionStorage || {})) {
      sessionStorage.setItem(key, value);
    }

    for (const dbSnapshot of snapshot.indexedDB || []) {
      await restoreDatabase(dbSnapshot);
    }

    return {
      ok: true,
      summary: {
        localStorageKeys: Object.keys(snapshot.localStorage || {}).length,
        sessionStorageKeys: Object.keys(snapshot.sessionStorage || {}).length,
        indexedDBDatabases: Array.isArray(snapshot.indexedDB) ? snapshot.indexedDB.length : 0,
        indexedDBStores: Array.isArray(snapshot.indexedDB) ? snapshot.indexedDB.reduce((sum, db) => sum + (db.stores?.length || 0), 0) : 0
      }
    };
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }

  function restoreDatabase(dbSnapshot) {
    return new Promise((resolve, reject) => {
      if (!dbSnapshot?.name) {
        resolve();
        return;
      }

      const request = indexedDB.open(dbSnapshot.name, dbSnapshot.version || 1);

      request.onerror = () => reject(request.error || new Error(`Could not open IndexedDB database ${dbSnapshot.name}.`));
      request.onupgradeneeded = () => {
        const db = request.result;
        for (const storeSnapshot of dbSnapshot.stores || []) {
          let store;
          if (!db.objectStoreNames.contains(storeSnapshot.storeName)) {
            const options = {};
            if (storeSnapshot.keyPath !== null && storeSnapshot.keyPath !== undefined) {
              options.keyPath = storeSnapshot.keyPath;
            }
            if (storeSnapshot.autoIncrement) {
              options.autoIncrement = true;
            }
            store = db.createObjectStore(storeSnapshot.storeName, options);
          } else {
            store = request.transaction.objectStore(storeSnapshot.storeName);
          }

          for (const indexSnapshot of storeSnapshot.indexes || []) {
            if (!store.indexNames.contains(indexSnapshot.name)) {
              store.createIndex(indexSnapshot.name, indexSnapshot.keyPath, {
                unique: Boolean(indexSnapshot.unique),
                multiEntry: Boolean(indexSnapshot.multiEntry)
              });
            }
          }
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        const storeNames = (dbSnapshot.stores || [])
          .map((storeSnapshot) => storeSnapshot.storeName)
          .filter((storeName) => db.objectStoreNames.contains(storeName));

        if (!storeNames.length) {
          db.close();
          resolve();
          return;
        }

        const tx = db.transaction(storeNames, 'readwrite');
        tx.onerror = () => {
          db.close();
          reject(tx.error || new Error(`Could not restore IndexedDB database ${dbSnapshot.name}.`));
        };
        tx.oncomplete = () => {
          db.close();
          resolve();
        };

        for (const storeSnapshot of dbSnapshot.stores || []) {
          if (!db.objectStoreNames.contains(storeSnapshot.storeName)) continue;
          const store = tx.objectStore(storeSnapshot.storeName);
          store.clear();
          for (const record of storeSnapshot.records || []) {
            store.put(record.value, record.key);
          }
        }
      };
    });
  }
}

function readPageMeta() {
  const clerk = (() => {
    try {
      const obj = window.Clerk || window.__clerk || null;
      if (!obj) return null;
      return {
        loaded: typeof obj.loaded === 'boolean' ? obj.loaded : null,
        frontendApi: obj.frontendApi || obj.frontend_api || null,
        publishableKey: obj.publishableKey || obj.publishable_key || null,
        hasClient: Boolean(obj.client),
        sessionCount: Array.isArray(obj.client?.sessions) ? obj.client.sessions.length : null,
        activeSessionId: obj.session?.id || obj.client?.activeSessions?.[0]?.id || null,
        userId: obj.user?.id || null,
        email: Array.isArray(obj.user?.emailAddresses) && obj.user.emailAddresses[0] ? obj.user.emailAddresses[0].emailAddress : null
      };
    } catch {
      return null;
    }
  })();

  return {
    title: document.title,
    url: location.href,
    userAgent: navigator.userAgent,
    clerk
  };
}
