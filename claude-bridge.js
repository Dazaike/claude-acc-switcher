(() => {
  if (window.__casClaudeBridgeInstalled) return;
  window.__casClaudeBridgeInstalled = true;

  const EVENT_NAME = 'cas:claude-bridge';

  const emit = (type, payload) => {
    try {
      window.dispatchEvent(new CustomEvent(EVENT_NAME, {
        detail: JSON.stringify({ type, payload })
      }));
    } catch {}
  };

  const toAbsoluteUrl = (input) => {
    try {
      if (typeof input === 'string') return input.startsWith('/') ? location.origin + input : input;
      if (input instanceof URL) return input.href;
      if (typeof Request !== 'undefined' && input instanceof Request) return input.url;
    } catch {}
    return '';
  };

  const getConversationMeta = (url) => {
    const match = url.match(/^https:\/\/claude\.ai\/api\/organizations\/([^/]+)\/chat_conversations\/([^/?]+)/);
    return match ? { orgId: match[1], conversationId: match[2] } : null;
  };

  const handleConversationResponse = async (meta, response) => {
    try {
      const data = await response.clone().json();
      emit('conversationData', { ...meta, data });
    } catch {}
  };

  const handleEventStream = async (response) => {
    try {
      const reader = response.clone().body?.getReader?.();
      if (!reader) return;
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r\n|\r|\n/);
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          const raw = line.slice(5).trim();
          if (!raw) continue;
          try {
            const json = JSON.parse(raw);
            if (json?.type === 'message_limit' && json.message_limit) {
              emit('messageLimit', json.message_limit);
            }
          } catch {}
        }
      }
    } catch {}
  };

  const dispatchUrlChange = () => emit('urlChange', { href: location.href });
  const originalFetch = window.fetch ? window.fetch.bind(window) : null;
  const originalPushState = history.pushState.bind(history);
  const originalReplaceState = history.replaceState.bind(history);

  history.pushState = function (...args) {
    const result = originalPushState(...args);
    dispatchUrlChange();
    return result;
  };

  history.replaceState = function (...args) {
    const result = originalReplaceState(...args);
    dispatchUrlChange();
    return result;
  };

  window.addEventListener('popstate', dispatchUrlChange, { passive: true });
  window.addEventListener('hashchange', dispatchUrlChange, { passive: true });

  if (originalFetch) {
    window.fetch = async (...args) => {
      const url = toAbsoluteUrl(args[0]);
      const method = String(args[1]?.method || 'GET').toUpperCase();

      if (url && method === 'POST' && (url.includes('/completion') || url.includes('/retry_completion'))) {
        emit('generationStart', {});
      }

      const response = await originalFetch(...args);
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('event-stream')) {
        handleEventStream(response);
      }

      if (url && url.includes('/chat_conversations/') && url.includes('tree=')) {
        const meta = getConversationMeta(url);
        if (meta) handleConversationResponse(meta, response);
      }

      return response;
    };
  }

  dispatchUrlChange();
})();
