(() => {
  if (!location.hostname.endsWith('claude.ai')) return;
  if (window.__casContentLoaded) return;
  window.__casContentLoaded = true;

  const PANEL_ID = 'cas-panel';
  const TOGGLE_ID = 'cas-toggle-btn';
  const TRACKER_STYLE_ID = 'cas-tracker-style';
  const TRACKER_INLINE_ID = 'cas-usage-tracker';
  const HEADER_ID = 'cas-token-header';
  const BRIDGE_SCRIPT_ID = 'cas-claude-bridge';
  const BRIDGE_EVENT = 'cas:claude-bridge';
  const ROOT_MESSAGE_ID = '00000000-0000-4000-8000-000000000000';
  const SETTINGS_KEY = 'cas_ext_settings';
  const CONTEXT_LIMIT_TOKENS = 200000;
  const CACHE_WINDOW_MS = 5 * 60 * 1000;
  const USAGE_POLL_MS = 60_000;
  const HOVER_REFRESH_MS = 30_000;
  const USAGE_MIN_GAP_MS = 15_000;

  const Utils = {
    uid() { return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`; },
    escHtml(value) {
      return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    },
    initials(name) {
      const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
      if (!parts.length) return 'A';
      if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
      return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
    },
    hue(seed) {
      let hash = 0;
      const text = String(seed || '');
      for (let i = 0; i < text.length; i += 1) {
        hash = (hash << 5) - hash + text.charCodeAt(i);
        hash |= 0;
      }
      return Math.abs(hash) % 360;
    },
    rel(ts) {
      const mins = Math.floor((Date.now() - Number(ts || 0)) / 60000);
      const hours = Math.floor(mins / 60);
      const days = Math.floor(hours / 24);
      if (!Number.isFinite(mins) || mins < 1) return 'just now';
      if (days > 0) return `${days}d ago`;
      if (hours > 0) return `${hours}h ago`;
      return `${mins}m ago`;
    }
  };

  const Icons = {
    users: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    refresh: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>',
    edit: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
    trash: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>',
    close: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    ok: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    warn: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f87171" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>'
  };

  const Style = `
    #${PANEL_ID},#${PANEL_ID} *{box-sizing:border-box;font-family:'Söhne',ui-sans-serif,system-ui,-apple-system,sans-serif;line-height:1.4}
    #${TOGGLE_ID},#${PANEL_ID},.cas-toast{all:initial}
    #${TOGGLE_ID}{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:8px;background:transparent;border:none;color:rgba(255,255,255,.72);cursor:pointer;padding:0;position:relative;flex-shrink:0;opacity:.85;transition:opacity .15s,background .15s;font-family:'Söhne',ui-sans-serif,system-ui,-apple-system,sans-serif}
    #${TOGGLE_ID}:hover{opacity:1;background:rgba(255,255,255,.10)}
    #${TOGGLE_ID} svg{pointer-events:none}
    .cas-login-row{display:flex;align-items:center;gap:8px;width:100%}
    .cas-login-row>button{flex:1 1 0;min-width:0}
    #${TOGGLE_ID} .cas-badge{position:absolute;top:-4px;right:-4px;min-width:18px;height:18px;padding:0 4px;border-radius:999px;background:#bb5c3c;color:#fff;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;border:2px solid #0e0e0e}
    #${PANEL_ID}{position:fixed;top:56px;right:16px;z-index:2147483646;width:300px;background:#2c2c2a;border:1px solid rgba(255,255,255,.09);border-radius:12px;overflow:hidden;display:none;flex-direction:column;animation:cas-up .18s cubic-bezier(0.2,0,0,1);max-height:min(560px,calc(100vh - 80px));color:#f0f0ec;font-family:'Söhne',ui-sans-serif,system-ui,-apple-system,sans-serif}
    #${PANEL_ID}.cas-open{display:flex}
    @keyframes cas-up{from{opacity:0;transform:translateY(-6px) scale(.98)}to{opacity:1;transform:translateY(0) scale(1)}}
    .cas-header{padding:12px 16px 10px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid rgba(255,255,255,.08);flex-shrink:0}
    .cas-title{font-size:12px;font-weight:500;color:#8a8a85;letter-spacing:.02em}
    .cas-icon-btn{background:none;border:none;color:#8a8a85;border-radius:6px;width:26px;height:26px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:color .15s,background .15s;padding:0}
    .cas-icon-btn:hover{color:#f0f0ec;background:#3a3a38}
    .cas-list{overflow-y:auto;flex:1;padding:4px 0;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.10) transparent}
    .cas-list::-webkit-scrollbar{width:3px}
    .cas-list::-webkit-scrollbar-thumb{background:rgba(255,255,255,.10);border-radius:3px}
    .cas-empty{padding:28px 18px;text-align:center;color:#8a8a85;font-size:13px}
    .cas-empty svg{display:block;margin:0 auto 10px;opacity:.2}
    .cas-row{display:flex;align-items:center;padding:10px 14px;gap:11px;cursor:pointer;transition:background .1s;position:relative}
    .cas-row:hover{background:#363634}
    .cas-row.cas-active{background:#363634}
    .cas-av{width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:#fff;flex-shrink:0;position:relative}
    .cas-av-inner{width:100%;height:100%;border-radius:50%;display:flex;align-items:center;justify-content:center}
    .cas-dot-g{position:absolute;bottom:0;right:0;width:9px;height:9px;background:#4ade80;border-radius:50%;border:2px solid #2c2c2a}
    .cas-dot-r{position:absolute;bottom:0;right:0;width:9px;height:9px;background:#f87171;border-radius:50%;border:2px solid #2c2c2a}
    .cas-info{flex:1;min-width:0}
    .cas-name{font-size:14px;font-weight:500;color:#f0f0ec;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .cas-sub{font-size:12px;color:#8a8a85;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px}
    .cas-acts{display:flex;gap:3px;opacity:0;transition:opacity .15s}
    .cas-row:hover .cas-acts{opacity:1}
    .cas-rb{background:none;border:none;color:#8a8a85;cursor:pointer;padding:4px;border-radius:5px;display:flex;align-items:center;justify-content:center;transition:color .12s,background .12s}
    .cas-rb:hover{color:#f0f0ec;background:#3e3e3c}
    .cas-rb.del:hover{color:#f87171;background:rgba(248,113,113,.10)}
    .cas-eb{padding:8px 14px 12px;display:none;flex-direction:column;gap:7px;background:#242422;border-top:1px solid rgba(255,255,255,.07)}
    .cas-eb.open{display:flex}
    .cas-footer{border-top:1px solid rgba(255,255,255,.08);padding:10px 12px;flex-shrink:0;display:flex;flex-direction:column;gap:6px}
    .cas-st{width:100%;padding:8px 12px;border-radius:8px;border:none;background:#363634;color:#d8d8d4;font-size:13px;font-weight:500;cursor:pointer;text-align:center;transition:background .15s,color .15s}
    .cas-st:hover{background:#3e3e3c;color:#f0f0ec}
    .cas-st.cas-danger{background:rgba(217,85,85,.10);color:#ffb4b4}
    .cas-st.cas-danger:hover{background:rgba(217,85,85,.18);color:#ffd0d0}
    .cas-form{display:none;flex-direction:column;gap:8px;margin-top:10px}
    .cas-form.open{display:flex}
    .cas-in{background:#242422;border:1px solid rgba(255,255,255,.10);border-radius:8px;color:#f0f0ec;font-size:13px;padding:8px 11px;outline:none;transition:border-color .15s;width:100%}
    .cas-in::placeholder{color:#6a6a66}
    .cas-in:focus{border-color:rgba(255,255,255,.28)}
    .cas-rr{display:flex;gap:7px}
    .cas-bp{flex:1;padding:8px 12px;background:#bb5c3c;border:none;border-radius:8px;color:#fff;font-size:13px;font-weight:600;cursor:pointer;transition:background .15s,transform .12s}
    .cas-bp:hover{background:#c96848}
    .cas-bp:active{transform:scale(.97)}
    .cas-bp.loading{opacity:.6;pointer-events:none}
    .cas-bs{padding:8px 12px;background:#363634;border:none;border-radius:8px;color:#d8d8d4;font-size:13px;font-weight:500;cursor:pointer;transition:background .15s}
    .cas-bs:hover{background:#3e3e3c}
    .cas-diag{margin:8px 12px 2px;padding:9px 12px;background:rgba(187,92,60,.10);border:1px solid rgba(187,92,60,.22);border-radius:8px;font-size:11.5px;color:rgba(255,200,150,.90);line-height:1.5}
    .cas-diag strong{color:#bb5c3c;display:block;margin-bottom:3px}
    .cas-diag pre{margin:5px 0 0;font-family:monospace;font-size:10px;color:rgba(255,255,255,.40);white-space:pre-wrap;word-break:break-all;max-height:80px;overflow-y:auto;background:rgba(0,0,0,.3);padding:5px 7px;border-radius:5px}
    .cas-toast{position:fixed;bottom:24px;right:24px;z-index:2147483647;background:#2c2c2a;border:1px solid rgba(255,255,255,.09);border-radius:10px;padding:10px 16px;color:#f0f0ec;font-size:13px;font-family:'Söhne',ui-sans-serif,system-ui,sans-serif;display:flex;align-items:center;gap:9px;animation:cas-tin .18s ease forwards;max-width:300px}
    .cas-toast.out{animation:cas-tout .22s ease forwards}
    @keyframes cas-tin{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
    @keyframes cas-tout{from{opacity:1;transform:translateY(0)}to{opacity:0;transform:translateY(10px)}}
    #${HEADER_ID}{margin-top:2px;font-family:'Söhne',ui-sans-serif,system-ui,-apple-system,sans-serif;font-size:12px;line-height:1.3;color:var(--text-500,#8c8c87);user-select:none}
    #${HEADER_ID} .cas-token-inner{display:flex;align-items:center;gap:6px;white-space:nowrap}
    #${HEADER_ID} .cas-token-strong{font-weight:600;color:var(--text-100,#f5f5f0)}
    #${HEADER_ID} .cas-token-faint{opacity:.78}
    #${HEADER_ID} .cas-token-bar{position:relative;width:60px;height:7px;border-radius:999px;border:1px solid rgba(120,120,119,.6);overflow:hidden;flex:0 0 auto}
    #${HEADER_ID} .cas-token-fill{height:100%;width:0%;background:#2c84db;transition:width .25s ease}
    #${TRACKER_INLINE_ID}{position:absolute;left:16px;right:16px;bottom:-15px;z-index:30;font-family:var(--font-ui,'Söhne',system-ui,-apple-system,Segoe UI,Roboto,sans-serif);color:hsl(var(--text-100))}
    #${TRACKER_INLINE_ID} .cas-usage-trigger{height:12px;display:flex;align-items:center;cursor:pointer}
    #${TRACKER_INLINE_ID} .cas-usage-track{width:100%;height:3px;background:hsla(var(--border-300)/.12);border-radius:999px;overflow:hidden;transition:height .16s ease}
    #${TRACKER_INLINE_ID} .cas-usage-trigger:hover .cas-usage-track{height:4px}
    #${TRACKER_INLINE_ID} .cas-usage-fill{height:100%;width:0%;background:hsl(var(--brand-000));transition:width .25s ease}
    #${TRACKER_INLINE_ID} .cas-usage-fill.warn{background:hsl(var(--warning-100))}
    #${TRACKER_INLINE_ID} .cas-usage-fill.danger{background:hsl(var(--danger-100))}
    #${TRACKER_INLINE_ID} .cas-usage-pop{position:absolute;bottom:14px;left:0;right:0;background:hsl(var(--bg-000));border-radius:16px;display:flex;flex-direction:column;gap:10px;padding:12px 14px 10px;opacity:0;visibility:hidden;pointer-events:none;transform:translateY(8px);transition:opacity .16s ease,transform .16s ease,visibility 0s linear .16s}
    #${TRACKER_INLINE_ID}:hover .cas-usage-pop{opacity:1;visibility:visible;transform:translateY(0);transition:opacity .16s ease,transform .16s ease}
    #${TRACKER_INLINE_ID} .cas-usage-row{display:flex;flex-direction:column;gap:6px}
    #${TRACKER_INLINE_ID} .cas-usage-head{display:flex;justify-content:space-between;align-items:flex-end;gap:12px;margin-bottom:2px;font-size:13px;line-height:1.1}
    #${TRACKER_INLINE_ID} .cas-usage-label{font-weight:550;color:hsl(var(--text-100))}
    #${TRACKER_INLINE_ID} .cas-usage-meta{font-size:12px;font-weight:430;color:hsl(var(--text-500));white-space:nowrap}
    #${TRACKER_INLINE_ID} .cas-usage-bar{width:100%;height:6px;background:hsla(var(--border-300)/.12);border-radius:999px;overflow:hidden}
    #${TRACKER_INLINE_ID} .cas-hidden{display:none !important}
    .cas-usage-anchor{transition:background-color .2s ease,box-shadow .2s ease,border-color .2s ease}
    .cas-usage-anchor.cas-usage-hover{background-color:transparent !important;box-shadow:none !important;border-color:transparent !important}
    .cas-usage-anchor > :not(#${TRACKER_INLINE_ID}){transition:opacity .2s ease}
    .cas-usage-anchor.cas-usage-hover > :not(#${TRACKER_INLINE_ID}){opacity:0 !important;pointer-events:none !important}
    @media (prefers-reduced-motion:reduce){#${TRACKER_INLINE_ID} .cas-usage-track,#${TRACKER_INLINE_ID} .cas-usage-fill,#${TRACKER_INLINE_ID} .cas-usage-pop,.cas-usage-anchor,.cas-usage-anchor>:not(#${TRACKER_INLINE_ID}){transition:none !important}}
    @media (max-width: 720px){#${PANEL_ID}{right:8px;top:56px;width:min(330px,calc(100vw - 16px));max-height:min(560px,calc(100vh - 80px))}.cas-toast{right:16px;bottom:24px;max-width:calc(100vw - 32px)}#${TRACKER_INLINE_ID}{left:12px;right:12px}}
  `;

  function injectBridge() {
    if (document.getElementById(BRIDGE_SCRIPT_ID)) return;
    const script = document.createElement('script');
    script.id = BRIDGE_SCRIPT_ID;
    script.src = chrome.runtime.getURL('claude-bridge.js');
    script.async = false;
    (document.documentElement || document.head).appendChild(script);
  }

  function waitForElement(selector, timeoutMs = 0) {
    return new Promise((resolve) => {
      const existing = document.querySelector(selector);
      if (existing) {
        resolve(existing);
        return;
      }
      let timer = null;
      const observer = new MutationObserver(() => {
        const next = document.querySelector(selector);
        if (!next) return;
        if (timer) clearTimeout(timer);
        observer.disconnect();
        resolve(next);
      });
      const start = () => {
        observer.observe(document.documentElement, { childList: true, subtree: true });
        if (timeoutMs > 0) {
          timer = setTimeout(() => {
            observer.disconnect();
            resolve(null);
          }, timeoutMs);
        }
      };
      if (document.documentElement) start();
      else document.addEventListener('DOMContentLoaded', start, { once: true });
    });
  }

  function getConversationId() {
    const match = location.pathname.match(/\/chat\/([^/?]+)/);
    return match ? match[1] : null;
  }

  function getOrgIdFromCookie() {
    try {
      return document.cookie.split('; ').find((row) => row.startsWith('lastActiveOrg='))?.split('=')[1] || null;
    } catch {
      return null;
    }
  }

  async function fetchJson(path, init) {
    const response = await fetch(path, { credentials: 'include', ...init });
    if (!response.ok) throw new Error(`Claude request failed: ${response.status}`);
    return response.json();
  }

  function stableStringify(value) {
    const seen = new WeakSet();
    const normalize = (input) => {
      if (input === null || typeof input !== 'object') return input;
      if (seen.has(input)) return '[Circular]';
      seen.add(input);
      if (Array.isArray(input)) return input.map(normalize);
      const out = {};
      for (const key of Object.keys(input).sort()) out[key] = normalize(input[key]);
      return out;
    };
    try {
      return JSON.stringify(normalize(value));
    } catch {
      return '';
    }
  }

  function getTokenizer() {
    return globalThis.GPTTokenizer_o200k_base || null;
  }

  function countTokens(text) {
    if (!text) return 0;
    const tokenizer = getTokenizer();
    if (tokenizer && typeof tokenizer.countTokens === 'function') {
      try {
        return tokenizer.countTokens(text);
      } catch {}
    }
    return Math.max(0, Math.ceil(text.length / 4));
  }

  function buildTrunk(conversation) {
    const messages = Array.isArray(conversation?.chat_messages) ? conversation.chat_messages : [];
    const byId = new Map();
    for (const message of messages) {
      if (message?.uuid) byId.set(message.uuid, message);
    }
    const leaf = conversation?.current_leaf_message_uuid;
    if (!leaf) return [];
    const trunk = [];
    let currentId = leaf;
    while (currentId && currentId !== ROOT_MESSAGE_ID) {
      const message = byId.get(currentId);
      if (!message) break;
      trunk.push(message);
      currentId = message.parent_message_uuid;
    }
    trunk.reverse();
    return trunk;
  }

  function isCountableContentItem(item) {
    if (!item || typeof item !== 'object' || typeof item.type !== 'string') return false;
    if (item.type === 'thinking' || item.type === 'redacted_thinking') return false;
    if (item.type === 'image' || item.type === 'document') return false;
    return true;
  }

  function stringifyCountableContentItem(item) {
    if (!isCountableContentItem(item)) return '';
    if (item.type === 'text' && typeof item.text === 'string') return item.text;
    if (item.type === 'tool_use') {
      return stableStringify({ id: item.id, name: item.name, input: item.input });
    }
    if (item.type === 'tool_result') {
      return stableStringify({ tool_use_id: item.tool_use_id, is_error: item.is_error, content: item.content });
    }
    const minimal = {};
    if (typeof item.text === 'string') minimal.text = item.text;
    if (typeof item.title === 'string') minimal.title = item.title;
    if (typeof item.url === 'string') minimal.url = item.url;
    if (typeof item.content === 'string') minimal.content = item.content;
    if (Array.isArray(item.content)) minimal.content = item.content;
    return Object.keys(minimal).length ? stableStringify(minimal) : '';
  }

  function stringifyMessageCountables(message) {
    const parts = [];
    const content = Array.isArray(message?.content) ? message.content : [];
    for (const item of content) {
      const chunk = stringifyCountableContentItem(item);
      if (chunk) parts.push(chunk);
    }
    const attachments = Array.isArray(message?.attachments) ? message.attachments : [];
    for (const attachment of attachments) {
      if (typeof attachment?.extracted_content === 'string' && attachment.extracted_content) {
        parts.push(attachment.extracted_content);
      }
    }
    return parts.join('\n');
  }

  async function hashString(str) {
    if (!crypto?.subtle?.digest) return null;
    try {
      const data = new TextEncoder().encode(str);
      const digest = await crypto.subtle.digest('SHA-256', data);
      return Array.from(new Uint8Array(digest).slice(0, 8), (byte) => byte.toString(16).padStart(2, '0')).join('');
    } catch {
      return null;
    }
  }

  async function fingerprint(text) {
    if (!text) return null;
    const hash = await hashString(text);
    return hash ? `${text.length}:${hash}` : null;
  }

  class TokenCache {
    constructor() {
      this.byMessageId = new Map();
    }

    async getMessageTokens(messageId, text) {
      const fp = await fingerprint(text);
      if (!fp) return countTokens(text);
      const cached = this.byMessageId.get(messageId);
      if (cached && cached.fp === fp) return cached.tokens;
      const tokens = countTokens(text);
      this.byMessageId.set(messageId, { fp, tokens });
      return tokens;
    }

    pruneToMessageIds(ids) {
      const keep = new Set(ids);
      for (const key of this.byMessageId.keys()) {
        if (!keep.has(key)) this.byMessageId.delete(key);
      }
    }
  }

  const tokenCache = new TokenCache();

  async function computeConversationMetrics(conversation) {
    const trunk = buildTrunk(conversation);
    tokenCache.pruneToMessageIds(trunk.map((message) => message.uuid).filter(Boolean));
    let totalTokens = 0;
    let lastAssistantMs = null;
    for (const message of trunk) {
      if (message?.sender === 'assistant' && message?.created_at) {
        const createdMs = Date.parse(message.created_at);
        if (!lastAssistantMs || createdMs > lastAssistantMs) lastAssistantMs = createdMs;
      }
      const text = stringifyMessageCountables(message);
      const tokens = message?.uuid ? await tokenCache.getMessageTokens(message.uuid, text) : countTokens(text);
      totalTokens += tokens;
    }
    return {
      totalTokens,
      cachedUntil: lastAssistantMs ? lastAssistantMs + CACHE_WINDOW_MS : null
    };
  }

  function formatSeconds(totalSeconds) {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  }

  function formatResetCountdown(value) {
    if (!value) return 'N/A';
    const diffMs = value - Date.now();
    if (diffMs <= 0) return 'Resetting soon';
    const totalMinutes = Math.round(diffMs / 60000);
    if (totalMinutes < 60) return `In ${totalMinutes} min`;
    const hours = Math.floor(totalMinutes / 60);
    if (hours < 24) return `In ${hours} hr`;
    return `In ${Math.floor(hours / 24)} days`;
  }

  const Tracker = {
    state: {
      orgId: null,
      currentConversationId: null,
      usage: null,
      lastUsageAt: 0,
      usageInflight: null,
      cachePending: false,
      tokenMetrics: null,
      lastUsageHoverRefreshAt: 0,
      pollTimer: 0,
      headerTimer: 0,
      domObserver: null,
      chatBaseline: null,
      chatBaselinePending: false
    },
    headerEl: null,
    inlineRoot: null,
    inlineAnchor: null,
    inlineUi: null,
    inlineTrackerEnabled: true,
    async init() {
      await this.loadSettings();
      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === 'local' && changes[SETTINGS_KEY]) {
          this.inlineTrackerEnabled = changes[SETTINGS_KEY].newValue?.inlineTrackerEnabled !== false;
          this.attachInlineUsage();
        }
      });
      this.injectStyle();
      injectBridge();
      this.buildHeader();
      this.attachBridgeListeners();
      this.observeDom();
      this.startPoll();
      const boot = async () => {
        this.attachHeader();
        this.attachInlineUsage();
        await this.handleUrlChange();
      };
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => { boot(); }, { once: true });
      } else {
        boot();
      }
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
          this.stopPoll();
        } else {
          this.attachHeader();
          this.attachInlineUsage();
          this.refreshUsage(true);
          this.startPoll();
        }
      }, { passive: true });
      window.addEventListener('focus', () => {
        if (!document.hidden) this.refreshUsage(true);
      }, { passive: true });
    },
    async loadSettings() {
      try {
        const stored = await chrome.storage.local.get(SETTINGS_KEY);
        this.inlineTrackerEnabled = stored[SETTINGS_KEY]?.inlineTrackerEnabled !== false;
      } catch {
        this.inlineTrackerEnabled = true;
      }
    },
    injectStyle() {
      if (document.getElementById(TRACKER_STYLE_ID)) return;
      const style = document.createElement('style');
      style.id = TRACKER_STYLE_ID;
      style.textContent = Style;
      (document.head || document.documentElement).appendChild(style);
    },
    buildHeader() {
      if (this.headerEl) return;
      const root = document.createElement('div');
      root.id = HEADER_ID;
      root.innerHTML = `
        <div class="cas-token-inner">
          <span class="cas-token-main"><span class="cas-token-strong"></span> tokens</span>
          <div class="cas-token-bar cas-hidden"><div class="cas-token-fill"></div></div>
          <span class="cas-token-cache cas-token-faint"></span>
        </div>
      `;
      this.headerEl = root;
    },
    buildInlineUi() {
      if (this.inlineRoot) return;
      const rows = [
        ['five_hour', 'Current Session'],
        ['this_chat', 'This Chat'],
        ['seven_day', 'Weekly Limit (All)'],
        ['seven_day_opus', 'Weekly Limit (Opus)']
      ];
      const root = document.createElement('div');
      root.id = TRACKER_INLINE_ID;
      root.innerHTML = `
        <div class="cas-usage-trigger">
          <div class="cas-usage-track"><div class="cas-usage-fill" data-role="top-fill"></div></div>
        </div>
        <div class="cas-usage-pop">
          ${rows.map(([key, label]) => `
            <div class="cas-usage-row cas-hidden" data-key="${key}">
              <div class="cas-usage-head">
                <span class="cas-usage-label">${label}</span>
                <span class="cas-usage-meta"></span>
              </div>
              <div class="cas-usage-bar"><div class="cas-usage-fill"></div></div>
            </div>
          `).join('')}
        </div>
      `;
      root.addEventListener('pointerenter', () => {
        if (this.inlineAnchor) this.inlineAnchor.classList.add('cas-usage-hover');
        if (Date.now() - this.state.lastUsageHoverRefreshAt > HOVER_REFRESH_MS) {
          this.state.lastUsageHoverRefreshAt = Date.now();
          this.refreshUsage(true);
        }
      }, { passive: true });
      root.addEventListener('pointerleave', () => {
        this.inlineAnchor?.classList.remove('cas-usage-hover');
      }, { passive: true });
      this.inlineRoot = root;
      this.inlineUi = {
        topFill: root.querySelector('[data-role="top-fill"]'),
        rows: Array.from(root.querySelectorAll('.cas-usage-row')).reduce((acc, row) => {
          acc[row.dataset.key] = {
            row,
            meta: row.querySelector('.cas-usage-meta'),
            fill: row.querySelector('.cas-usage-fill')
          };
          return acc;
        }, {})
      };
    },
    attachBridgeListeners() {
      window.addEventListener(BRIDGE_EVENT, (event) => {
        const raw = event?.detail;
        if (!raw) return;
        let data;
        try {
          data = typeof raw === 'string' ? JSON.parse(raw) : raw;
        } catch {
          return;
        }
        const { type, payload } = data || {};
        if (type === 'generationStart') {
          this.state.cachePending = true;
          this.renderHeader();
          return;
        }
        if (type === 'messageLimit') {
          this.applyUsage(this.parseUsageFromMessageLimit(payload));
          return;
        }
        if (type === 'conversationData') {
          this.handleConversationPayload(payload);
          return;
        }
        if (type === 'urlChange') this.handleUrlChange();
      });
    },
    observeDom() {
      const connect = () => {
        if (this.state.domObserver || !document.body) return;
        let _domDebounce = 0;
        this.state.domObserver = new MutationObserver(() => {
          clearTimeout(_domDebounce);
          _domDebounce = setTimeout(() => {
            if (this.headerEl && !document.contains(this.headerEl)) this.attachHeader();
            if (this.inlineRoot && !document.contains(this.inlineRoot)) this.attachInlineUsage();
            if (UI.toggleBtn && !document.contains(UI.toggleBtn)) UI.attachToggle();
          }, 100);
        });
        this.state.domObserver.observe(document.body, { childList: true, subtree: true });
      };
      if (document.body) connect();
      else document.addEventListener('DOMContentLoaded', connect, { once: true });
    },
    async resolveOrgId(force = false) {
      if (!force && this.state.orgId) return this.state.orgId;
      const cookieOrg = getOrgIdFromCookie();
      if (cookieOrg) {
        this.state.orgId = cookieOrg;
        return cookieOrg;
      }
      try {
        const orgs = await fetchJson('/api/organizations');
        const id = orgs?.[0]?.uuid || null;
        if (id) this.state.orgId = id;
        return id;
      } catch {
        return this.state.orgId;
      }
    },
    attachHeader() {
      if (!this.headerEl) this.buildHeader();
      const target = document.querySelector('[data-testid="chat-menu-trigger"]');
      if (!target || this.headerEl.parentElement === target.parentElement) {
        this.renderHeader();
        return;
      }
      target.parentElement?.appendChild(this.headerEl);
      this.renderHeader();
    },
    findUsageAnchor() {
      const editor = document.querySelector('[contenteditable="true"].tiptap');
      if (!editor) return null;
      const fieldset = editor.closest('fieldset');
      if (!fieldset) return null;
      return fieldset.querySelector('div[class*="bg-bg-000"][class*="rounded-[20px]"]') || fieldset;
    },
    attachInlineUsage() {
      if (!this.inlineTrackerEnabled) {
        this.inlineRoot?.remove();
        this.inlineAnchor?.classList.remove('cas-usage-anchor', 'cas-usage-hover');
        this.inlineAnchor = null;
        return;
      }
      if (!this.inlineRoot) this.buildInlineUi();
      const anchor = this.findUsageAnchor();
      if (!anchor) return;
      if (anchor === this.inlineAnchor && anchor.contains(this.inlineRoot)) {
        this.renderUsage();
        return;
      }
      this.inlineRoot?.remove();
      this.inlineAnchor?.classList.remove('cas-usage-anchor', 'cas-usage-hover');
      anchor.classList.add('cas-usage-anchor');
      if (getComputedStyle(anchor).position === 'static') anchor.style.position = 'relative';
      anchor.insertBefore(this.inlineRoot, anchor.firstChild);
      this.inlineAnchor = anchor;
      this.renderUsage();
    },
    parseUsageFromUsageEndpoint(raw) {
      if (!raw || typeof raw !== 'object') return null;
      const normalize = (windowUsage) => {
        if (!windowUsage || typeof windowUsage !== 'object') return null;
        if (typeof windowUsage.utilization !== 'number' || !Number.isFinite(windowUsage.utilization)) return null;
        return {
          utilization: Math.max(0, Math.min(100, windowUsage.utilization)),
          resets_at: typeof windowUsage.resets_at === 'string' ? windowUsage.resets_at : null
        };
      };
      const parsed = {
        five_hour: normalize(raw.five_hour),
        seven_day: normalize(raw.seven_day),
        seven_day_opus: normalize(raw.seven_day_opus)
      };
      return parsed.five_hour || parsed.seven_day || parsed.seven_day_opus ? parsed : null;
    },
    parseUsageFromMessageLimit(raw) {
      if (!raw?.windows || typeof raw.windows !== 'object') return null;
      const normalize = (windowUsage) => {
        if (!windowUsage || typeof windowUsage !== 'object') return null;
        if (typeof windowUsage.utilization !== 'number' || !Number.isFinite(windowUsage.utilization)) return null;
        return {
          utilization: Math.max(0, Math.min(100, windowUsage.utilization * 100)),
          resets_at: typeof windowUsage.resets_at === 'number' ? new Date(windowUsage.resets_at * 1000).toISOString() : null
        };
      };
      const parsed = {
        five_hour: normalize(raw.windows['5h']),
        seven_day: normalize(raw.windows['7d']),
        seven_day_opus: normalize(raw.windows['7d_opus'])
      };
      return parsed.five_hour || parsed.seven_day || parsed.seven_day_opus ? parsed : null;
    },
    applyUsage(usage) {
      if (!usage) return;
      this.state.usage = usage;
      this.state.lastUsageAt = Date.now();
      this.renderUsage();
    },
    setFill(el, percent) {
      const p = Math.max(0, Math.min(100, Number(percent) || 0));
      el.style.width = `${p}%`;
      el.classList.toggle('warn', p > 60);
      el.classList.toggle('danger', p > 80);
    },
    renderUsage() {
      if (!this.inlineUi) return;
      const usage = this.state.usage;
      const topPercent = usage?.five_hour?.utilization ?? usage?.seven_day?.utilization ?? usage?.seven_day_opus?.utilization ?? 0;
      this.setFill(this.inlineUi.topFill, topPercent);
      let visibleCount = 0;
      for (const [key, ui] of Object.entries(this.inlineUi.rows)) {
        if (key === 'this_chat') {
          const current = usage?.five_hour?.utilization;
          const baseline = this.state.chatBaseline;
          if (typeof current !== 'number' || typeof baseline !== 'number') {
            ui.row.classList.add('cas-hidden');
            continue;
          }
          const delta = current - baseline;
          visibleCount += 1;
          ui.row.classList.remove('cas-hidden');
          if (delta < 0) {
            this.setFill(ui.fill, 0);
            ui.meta.textContent = 'N/A';
          } else {
            this.setFill(ui.fill, delta);
            ui.meta.textContent = `${Math.round(delta * 10) / 10}%`;
          }
          continue;
        }
        const block = usage?.[key];
        if (!block) {
          ui.row.classList.add('cas-hidden');
          continue;
        }
        visibleCount += 1;
        ui.row.classList.remove('cas-hidden');
        this.setFill(ui.fill, block.utilization);
        const resetText = block.resets_at ? formatResetCountdown(Date.parse(block.resets_at)) : 'N/A';
        ui.meta.textContent = `${Math.round(block.utilization * 10) / 10}% · ${resetText}`;
      }
      this.inlineRoot?.classList.toggle('cas-hidden', visibleCount === 0);
    },
    renderHeader() {
      if (!this.headerEl) return;
      const main = this.headerEl.querySelector('.cas-token-main');
      const strong = main.querySelector('.cas-token-strong');
      const cache = this.headerEl.querySelector('.cas-token-cache');
      const bar = this.headerEl.querySelector('.cas-token-bar');
      const fill = this.headerEl.querySelector('.cas-token-fill');
      const metrics = this.state.tokenMetrics;
      if (!metrics || typeof metrics.totalTokens !== 'number') {
        if (this.headerEl.style.display !== 'none') {
          strong.textContent = '';
          cache.textContent = '';
          bar.classList.add('cas-hidden');
          this.headerEl.style.display = 'none';
        }
        return;
      }
      if (this.headerEl.style.display === 'none') this.headerEl.style.display = '';
      const tokenText = `~${metrics.totalTokens.toLocaleString()}`;
      if (strong.textContent !== tokenText) strong.textContent = tokenText;
      const pct = Math.max(0, Math.min(100, (metrics.totalTokens / CONTEXT_LIMIT_TOKENS) * 100));
      if (pct >= 99.5) {
        bar.classList.add('cas-hidden');
      } else {
        bar.classList.remove('cas-hidden');
        const pctStr = `${pct}%`;
        if (fill.style.width !== pctStr) fill.style.width = pctStr;
      }
      let cacheText;
      if (this.state.cachePending) {
        cacheText = 'refreshing cache...';
      } else if (metrics.cachedUntil && metrics.cachedUntil > Date.now()) {
        cacheText = `cached for ${formatSeconds(Math.ceil((metrics.cachedUntil - Date.now()) / 1000))}`;
      } else {
        cacheText = '';
      }
      if (cache.textContent !== cacheText) cache.textContent = cacheText;
    },
    async requestConversation() {
      const orgId = await this.resolveOrgId();
      const conversationId = this.state.currentConversationId;
      if (!orgId || !conversationId) return null;
      return fetchJson(`/api/organizations/${orgId}/chat_conversations/${conversationId}?tree=true&rendering_mode=messages&render_all_tools=true`);
    },
    async refreshConversation() {
      if (!this.state.currentConversationId) {
        this.state.tokenMetrics = null;
        this.state.cachePending = false;
        this.renderHeader();
        return;
      }
      try {
        const data = await this.requestConversation();
        if (data) {
          await this.handleConversationPayload({
            orgId: this.state.orgId,
            conversationId: this.state.currentConversationId,
            data
          });
        }
      } catch {}
    },
    async handleConversationPayload(payload) {
      if (!payload?.conversationId || payload.conversationId !== this.state.currentConversationId) return;
      if (payload.orgId) this.state.orgId = payload.orgId;
      const metrics = await computeConversationMetrics(payload.data);
      this.state.tokenMetrics = metrics;
      this.state.cachePending = false;
      this.renderHeader();
    },
    async refreshUsage(force = false) {
      if (!force && Date.now() - this.state.lastUsageAt < USAGE_MIN_GAP_MS) return this.state.usage;
      if (this.state.usageInflight) return this.state.usageInflight;
      this.state.usageInflight = (async () => {
        try {
          const orgId = await this.resolveOrgId(force);
          if (!orgId) return this.state.usage;
          const raw = await fetchJson(`/api/organizations/${orgId}/usage`);
          const usage = this.parseUsageFromUsageEndpoint(raw);
          this.applyUsage(usage);
          return usage;
        } catch {
          this.state.orgId = null;
          return this.state.usage;
        } finally {
          this.state.usageInflight = null;
        }
      })();
      return this.state.usageInflight;
    },
    async handleUrlChange() {
      this.state.currentConversationId = getConversationId();
      this.state.chatBaseline = null;
      this.attachHeader();
      this.attachInlineUsage();
      UI.attachToggle();
      if (getConversationId()) UI.close();
      await this.resolveOrgId();
      await Promise.all([this.refreshConversation(), this.refreshUsage(false)]);
      this.captureChatBaseline();
    },
    captureChatBaseline() {
      if (this.state.chatBaseline !== null || this.state.chatBaselinePending) return;
      const current = this.state.usage?.five_hour?.utilization;
      if (typeof current === 'number') {
        this.state.chatBaseline = current;
        this.renderUsage();
        return;
      }
      this.state.chatBaselinePending = true;
      const poll = () => {
        const value = this.state.usage?.five_hour?.utilization;
        if (typeof value === 'number') {
          this.state.chatBaseline = value;
          this.state.chatBaselinePending = false;
          this.renderUsage();
          return;
        }
        setTimeout(poll, 500);
      };
      setTimeout(poll, 500);
    },
    tick() {
      this.renderHeader();
      const usage = this.state.usage;
      const resetTimes = [usage?.five_hour?.resets_at, usage?.seven_day?.resets_at, usage?.seven_day_opus?.resets_at]
        .filter(Boolean)
        .map((value) => Date.parse(value));
      if (resetTimes.some((time) => Number.isFinite(time) && Date.now() >= time)) this.refreshUsage(true);
      this.renderUsage();
    },
    startPoll() {
      this.stopPoll();
      this.state.pollTimer = window.setInterval(() => {
        if (document.hidden) return;
        this.tick();
        this.refreshUsage(false);
      }, USAGE_POLL_MS);
      this.state.headerTimer = window.setInterval(() => this.renderHeader(), 1000);
    },
    stopPoll() {
      if (this.state.pollTimer) clearInterval(this.state.pollTimer);
      if (this.state.headerTimer) clearInterval(this.state.headerTimer);
      this.state.pollTimer = 0;
      this.state.headerTimer = 0;
    }
  };

  const ThinkingBadge = {
    STORAGE_KEY: 'cas-thinking-state',
    timer: 0,
    cache: {},
    init() {
      try {
        this.cache = JSON.parse(localStorage.getItem(this.STORAGE_KEY)) || {};
      } catch {
        this.cache = {};
      }
      this.sync();
      this.timer = window.setInterval(() => this.sync(), 1000);
      new MutationObserver(() => this.sync()).observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['aria-checked'],
        subtree: true
      });
    },
    familyFor(dropdown) {
      const nameEl = dropdown.querySelector('.min-w-0');
      const name = (nameEl?.firstChild?.textContent || nameEl?.textContent || '').trim();
      return name.split(/\s+/)[0]?.toLowerCase() || null;
    },
    sync() {
      const dropdown = document.querySelector('[data-testid="model-selector-dropdown"]');
      if (!dropdown) return;
      const badge = dropdown.querySelector('span.ml-1');
      if (!badge) return;
      const family = this.familyFor(dropdown);

      const toggle = document.querySelector('[role="switch"][aria-label="Thinking"]');
      if (toggle && family) {
        const isOn = toggle.getAttribute('aria-checked') === 'true';
        if (this.cache[family] !== isOn) {
          this.cache[family] = isOn;
          localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.cache));
        }
      }

      if (!family || !(family in this.cache)) return;
      const shouldHide = this.cache[family] === false;
      const isHidden = badge.style.display === 'none';
      if (shouldHide && !isHidden) badge.style.display = 'none';
      else if (!shouldHide && isHidden) badge.style.display = '';
    }
  };

  const UI = {
    panel: null,
    toggleBtn: null,
    formOpen: false,
    state: {
      accounts: [],
      activeId: null
    },
    async init() {
      this.injectStyle();
      this.makeToggle();
      this.makePanel();
      this.attachToggle();
      document.addEventListener('click', () => this.close());
      window.addEventListener('focus', () => this.refresh(false));
      window.addEventListener('resize', () => {
        if (this.panel?.classList.contains('cas-open')) this.positionPanel();
      });
      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === 'local' && Object.keys(changes).some((key) => key.startsWith('cas_ext_'))) {
          this.refresh(false);
        }
      });
      await this.refresh(false);
    },
    injectStyle() {
      if (document.getElementById('cas-inline-style')) return;
      const style = document.createElement('style');
      style.id = 'cas-inline-style';
      style.textContent = Style;
      document.documentElement.appendChild(style);
    },
    makeToggle() {
      const button = document.createElement('button');
      button.id = TOGGLE_ID;
      button.type = 'button';
      button.title = 'Account Switcher';
      button.innerHTML = Icons.users;
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        this.toggle();
      });
      this.toggleBtn = button;
      this.updateBadge();
    },
    findLoginEmailButton() {
      if (!/^\/login(?:\/|$)/.test(location.pathname)) return null;
      return Array.from(document.querySelectorAll('button')).find((button) => {
        const text = (button.textContent || '').replace(/\s+/g, ' ').trim();
        return /continue with email/i.test(text);
      }) || null;
    },
    attachToggleToLoginButton(emailButton) {
      if (!emailButton || !emailButton.parentElement) return false;
      let row = emailButton.closest('.cas-login-row');
      if (!row) {
        row = document.createElement('div');
        row.className = 'cas-login-row';
        emailButton.parentElement.insertBefore(row, emailButton);
        row.appendChild(emailButton);
      }
      if (this.toggleBtn.parentElement !== row) row.appendChild(this.toggleBtn);
      return true;
    },
    attachToggle() {
      if (!this.toggleBtn) return;
      const emailButton = this.findLoginEmailButton();
      if (this.attachToggleToLoginButton(emailButton)) {
        this.updateToggleVisibility();
        return;
      }
      const incognito = document.querySelector('button[aria-label="Use incognito"]');
      if (!incognito) return;
      const wrapper = incognito.closest('[data-base-ui-tooltip-trigger]') || incognito;
      let bar = wrapper.parentElement;
      let anchor = wrapper;
      for (let depth = 0; depth < 4 && bar; depth += 1) {
        if (bar.classList?.contains('flex') && bar.classList?.contains('items-center')) break;
        anchor = bar;
        bar = bar.parentElement;
      }
      if (!bar) return;
      if (this.toggleBtn.parentElement !== bar || this.toggleBtn.nextSibling !== anchor) {
        bar.insertBefore(this.toggleBtn, anchor);
      }
      this.updateToggleVisibility();
    },
    updateToggleVisibility() {
      if (!this.toggleBtn) return;
      const onConversation = Boolean(getConversationId());
      this.toggleBtn.style.display = onConversation ? 'none' : '';
    },
    makePanel() {
      const panel = document.createElement('div');
      panel.id = PANEL_ID;
      panel.innerHTML = `
        <div class="cas-header">
          <span class="cas-title">Accounts</span>
          <button class="cas-icon-btn" id="cas-x" type="button">${Icons.close}</button>
        </div>
        <div class="cas-list" id="cas-list"></div>
        <div class="cas-footer">
          <button class="cas-st" id="cas-open-form" type="button">+ Save current session</button>
          <button class="cas-st cas-danger" id="cas-logout" type="button">Log out of Claude</button>
          <div class="cas-form" id="cas-form">
            <input class="cas-in" id="cas-fn" type="text" placeholder="Display name (e.g. Work)" maxlength="40" autocomplete="off">
            <input class="cas-in" id="cas-fe" type="email" placeholder="Email (optional)" autocomplete="off">
            <div class="cas-rr">
              <button class="cas-bp" id="cas-fs" type="button">Save Session</button>
              <button class="cas-bs" id="cas-fc" type="button">Cancel</button>
            </div>
          </div>
        </div>`;
      panel.addEventListener('click', (event) => event.stopPropagation());
      document.body.appendChild(panel);
      this.panel = panel;
      panel.querySelector('#cas-x').addEventListener('click', () => this.close());
      panel.querySelector('#cas-open-form').addEventListener('click', () => {
        this.formOpen = !this.formOpen;
        panel.querySelector('#cas-form').classList.toggle('open', this.formOpen);
        if (this.formOpen) panel.querySelector('#cas-fn').focus();
      });
      panel.querySelector('#cas-logout').addEventListener('click', () => this.logoutCurrent());
      panel.querySelector('#cas-fc').addEventListener('click', () => this.closeForm());
      panel.querySelector('#cas-fs').addEventListener('click', () => this.saveCurrent());
      panel.querySelector('#cas-form').addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          panel.querySelector('#cas-fs').click();
        }
      });
    },
    async refresh(showRender = true) {
      const result = await send('cas:getState');
      if (!result?.ok) return;
      this.state.accounts = result.accounts || [];
      this.state.activeId = result.activeId || null;
      this.updateBadge();
      if (showRender || this.panel?.classList.contains('cas-open')) this.render();
    },
    updateBadge() {
      this.toggleBtn?.querySelector('.cas-badge')?.remove();
    },
    showDiag(text) {
      this.panel.querySelector('.cas-diag')?.remove();
      const el = document.createElement('div');
      el.className = 'cas-diag';
      el.innerHTML = `<strong>Couldn't save current session</strong>Make sure Claude is fully loaded and you're logged in, then try again.<pre>${Utils.escHtml(text)}</pre>`;
      this.panel.querySelector('#cas-list').before(el);
    },
    clearDiag() {
      this.panel?.querySelector('.cas-diag')?.remove();
    },
    closeForm() {
      this.formOpen = false;
      this.panel.querySelector('#cas-form').classList.remove('open');
      this.panel.querySelector('#cas-fn').value = '';
      this.panel.querySelector('#cas-fe').value = '';
    },
    render() {
      if (!this.panel) return;
      const list = this.panel.querySelector('#cas-list');
      this.clearDiag();
      if (!this.state.accounts.length) {
        list.innerHTML = '<div class="cas-empty"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>No saved accounts yet.<br>Log in and save your session below.</div>';
        return;
      }
      list.innerHTML = this.state.accounts.map((account) => {
        const active = account.id === this.state.activeId;
        const valid = Boolean(account?.snapshot?.cookies?.cookies?.length);
        const hue = Utils.hue(account.id);
        const sub = account.email ? Utils.escHtml(account.email) : `Saved ${Utils.rel(account.savedAt)}`;
        return `
          <div class="cas-row${active ? ' cas-active' : ''}" data-id="${account.id}">
            <div class="cas-av">
              <div class="cas-av-inner" style="background:hsl(${hue},45%,32%)">${Utils.escHtml(Utils.initials(account.name))}</div>
              ${active ? '<span class="cas-dot-g"></span>' : (!valid ? '<span class="cas-dot-r"></span>' : '')}
            </div>
            <div class="cas-info">
              <div class="cas-name">${Utils.escHtml(account.name || 'Unnamed')}</div>
              <div class="cas-sub">${sub}</div>
            </div>
            <div class="cas-acts">
              <button class="cas-rb ref" data-id="${account.id}" title="Re-save session" type="button">${Icons.refresh}</button>
              <button class="cas-rb edt" data-id="${account.id}" title="Rename" type="button">${Icons.edit}</button>
              <button class="cas-rb del" data-id="${account.id}" title="Remove" type="button">${Icons.trash}</button>
            </div>
          </div>
          <div class="cas-eb" id="eb-${account.id}">
            <input class="cas-in en" type="text" value="${Utils.escHtml(account.name || '')}" placeholder="Name" autocomplete="off" maxlength="40">
            <input class="cas-in ee" type="email" value="${Utils.escHtml(account.email || '')}" placeholder="Email (optional)" autocomplete="off">
            <div class="cas-rr">
              <button class="cas-bp es" data-id="${account.id}" type="button">Save</button>
              <button class="cas-bs ec" data-id="${account.id}" type="button">Cancel</button>
            </div>
          </div>`;
      }).join('');
      this.bindList(list);
    },
    bindList(list) {
      list.querySelectorAll('.cas-row').forEach((row) => {
        row.addEventListener('click', async (event) => {
          if (event.target.closest('button')) return;
          const result = await send('cas:switch', { id: row.dataset.id });
          if (!result?.ok) this.toast(result?.error || 'Switch failed.', 'warn');
        });
      });
      list.querySelectorAll('.cas-rb.ref').forEach((button) => {
        button.addEventListener('click', async (event) => {
          event.stopPropagation();
          button.style.opacity = '0.4';
          button.style.pointerEvents = 'none';
          const result = await send('cas:refresh', { id: button.dataset.id });
          button.style.opacity = '';
          button.style.pointerEvents = '';
          if (!result?.ok) {
            this.toast(result?.error || 'Re-save failed.', 'warn');
            return;
          }
          await this.refresh();
          this.toast('Session refreshed.', 'ok');
        });
      });
      list.querySelectorAll('.cas-rb.edt').forEach((button) => {
        button.addEventListener('click', (event) => {
          event.stopPropagation();
          const block = list.querySelector(`#eb-${button.dataset.id}`);
          const open = block.classList.contains('open');
          list.querySelectorAll('.cas-eb.open').forEach((node) => node.classList.remove('open'));
          if (!open) {
            block.classList.add('open');
            block.querySelector('.en').focus();
          }
        });
      });
      list.querySelectorAll('.cas-bp.es').forEach((button) => {
        button.addEventListener('click', async (event) => {
          event.stopPropagation();
          const block = list.querySelector(`#eb-${button.dataset.id}`);
          const name = block.querySelector('.en').value;
          const email = block.querySelector('.ee').value;
          if (!String(name).trim()) {
            this.toast('Name cannot be empty.', 'warn');
            return;
          }
          const result = await send('cas:rename', { id: button.dataset.id, name, email });
          if (!result?.ok) {
            this.toast(result?.error || 'Rename failed.', 'warn');
            return;
          }
          block.classList.remove('open');
          await this.refresh();
          this.toast('Account updated.', 'ok');
        });
      });
      list.querySelectorAll('.cas-bs.ec').forEach((button) => {
        button.addEventListener('click', (event) => {
          event.stopPropagation();
          list.querySelector(`#eb-${button.dataset.id}`)?.classList.remove('open');
        });
      });
      list.querySelectorAll('.cas-rb.del').forEach((button) => {
        button.addEventListener('click', async (event) => {
          event.stopPropagation();
          const account = this.state.accounts.find((item) => item.id === button.dataset.id);
          if (!account || !confirm(`Remove "${account.name}"?`)) return;
          const result = await send('cas:remove', { id: button.dataset.id });
          if (!result?.ok) {
            this.toast(result?.error || 'Delete failed.', 'warn');
            return;
          }
          await this.refresh();
          this.toast(`"${account.name}" removed.`, 'ok');
        });
      });
    },
    toggle() {
      if (this.panel.classList.contains('cas-open')) {
        this.close();
        return;
      }
      this.open();
    },
    async open() {
      await this.refresh();
      this.panel.classList.add('cas-open');
      this.positionPanel();
    },
    positionPanel() {
      if (!this.panel || !this.toggleBtn) return;
      const margin = 8;
      const gap = 8;
      const anchor = this.toggleBtn.getBoundingClientRect();
      const panelWidth = this.panel.offsetWidth || 300;
      const panelHeight = this.panel.offsetHeight || 420;
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      let left = anchor.right - panelWidth;
      if (left < margin) left = margin;
      if (left + panelWidth > viewportWidth - margin) {
        left = Math.max(margin, viewportWidth - panelWidth - margin);
      }

      let top = anchor.bottom + gap;
      if (top + panelHeight > viewportHeight - margin) {
        const above = anchor.top - panelHeight - gap;
        top = above >= margin ? above : Math.max(margin, viewportHeight - panelHeight - margin);
      }

      this.panel.style.left = `${Math.round(left)}px`;
      this.panel.style.top = `${Math.round(top)}px`;
      this.panel.style.right = 'auto';
    },
    close() {
      this.panel.classList.remove('cas-open');
      this.closeForm();
    },
    async saveCurrent() {
      const name = this.panel.querySelector('#cas-fn').value;
      const email = this.panel.querySelector('#cas-fe').value;
      if (!String(name).trim()) {
        this.toast('Enter a display name.', 'warn');
        return;
      }
      const button = this.panel.querySelector('#cas-fs');
      button.textContent = 'Saving...';
      button.classList.add('loading');
      this.clearDiag();
      const result = await send('cas:saveCurrent', { name, email });
      button.textContent = 'Save Session';
      button.classList.remove('loading');
      if (!result?.ok) {
        this.showDiag(result?.error || 'Save failed.');
        return;
      }
      this.closeForm();
      await this.refresh();
      this.toast(`Saved as "${name}"`, 'ok');
    },
    async logoutCurrent() {
      const button = this.panel.querySelector('#cas-logout');
      button.textContent = 'Logging out...';
      button.classList.add('loading');
      const result = await send('cas:logout');
      button.textContent = 'Log out of Claude';
      button.classList.remove('loading');
      if (!result?.ok) {
        this.toast(result?.error || 'Logout failed.', 'warn');
        return;
      }
      await this.refresh();
      this.toast('Claude cookies cleared. Refreshing tab.', 'ok');
      this.close();
    },
    toast(message, type = 'ok') {
      document.querySelector('.cas-toast')?.remove();
      if (this._toastTimer) clearTimeout(this._toastTimer);
      const toast = document.createElement('div');
      toast.className = 'cas-toast';
      toast.innerHTML = `<span>${type === 'warn' ? Icons.warn : Icons.ok}</span><span>${Utils.escHtml(message)}</span>`;
      document.body.appendChild(toast);
      this._toastTimer = setTimeout(() => {
        toast.classList.add('out');
        setTimeout(() => toast.remove(), 250);
      }, 3500);
    }
  };

  async function send(type, payload = {}) {
    return chrome.runtime.sendMessage({
      type,
      ...(type === 'cas:switch' || type === 'cas:remove' || type === 'cas:refresh'
        ? { id: payload.id }
        : type === 'cas:rename'
          ? { id: payload.id, payload: { name: payload.name, email: payload.email } }
          : { payload })
    });
  }

  function ready(fn) {
    if (document.body) {
      fn();
      return;
    }
    new MutationObserver((_, observer) => {
      if (document.body) {
        observer.disconnect();
        fn();
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  }

  Tracker.init().catch((error) => console.error('[CAS TRACKER]', error));
  ready(() => {
    UI.init().catch((error) => console.error('[CAS EXT]', error));
    ThinkingBadge.init();
  });
})();
