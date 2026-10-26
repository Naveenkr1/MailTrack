// Background Service Worker for Mail Track
let ws = null;
let reconnectInterval = 3000;

const PROD_SERVER_URL = 'https://mail-track-pink.vercel.app';
const LOCAL_SERVER_URL = 'http://localhost:4000';

let serverMode = 'production'; // 'production' | 'localhost'
let activeServerUrl = PROD_SERVER_URL;

let cachedConfig = {
  localUrl: LOCAL_SERVER_URL,
  publicUrl: PROD_SERVER_URL
};

async function getActiveServerUrl() {
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    const stored = await chrome.storage.local.get(['mt_server_mode', 'mt_active_server_url', 'mt_custom_server_url']);
    
    // Purge dead ephemeral tunnels or invalid domains from local storage
    if (stored.mt_active_server_url && (stored.mt_active_server_url.includes('trycloudflare.com') || stored.mt_active_server_url.includes('mailtrack.in'))) {
      chrome.storage.local.set({ mt_active_server_url: PROD_SERVER_URL });
    }
    if (stored.mt_custom_server_url && (stored.mt_custom_server_url.includes('trycloudflare.com') || stored.mt_custom_server_url.includes('mailtrack.in'))) {
      chrome.storage.local.set({ mt_custom_server_url: '' });
      stored.mt_custom_server_url = '';
    }

    if (stored.mt_custom_server_url && !stored.mt_custom_server_url.includes('trycloudflare.com') && !stored.mt_custom_server_url.includes('mailtrack.in')) {
      activeServerUrl = stored.mt_custom_server_url.replace(/\/+$/, '');
      return activeServerUrl;
    }
    // Only use localhost if the user has specifically selected localhost mode
    if (stored.mt_server_mode === 'localhost') {
      serverMode = 'localhost';
      activeServerUrl = LOCAL_SERVER_URL;
      return activeServerUrl;
    }
    // Default to the current live domain
    serverMode = 'production';
    activeServerUrl = PROD_SERVER_URL;
    return activeServerUrl;
  }
  return PROD_SERVER_URL;
}

async function probeAndSetActiveServer() {
  const url = await getActiveServerUrl();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`${url}/api/ping`, { signal: controller.signal, cache: 'no-store' });
    clearTimeout(timeout);
    if (res.ok) {
      activeServerUrl = url;
      return activeServerUrl;
    }
  } catch (e) {}
  activeServerUrl = PROD_SERVER_URL;
  return activeServerUrl;
}

async function getAuthTokenCookie() {
  if (typeof chrome === 'undefined' || !chrome.cookies || !chrome.cookies.getAll) return null;
  try {
    const cookies = await chrome.cookies.getAll({ name: 'mt_token' });
    if (!cookies || cookies.length === 0) return null;
    const currentHost = new URL(activeServerUrl).hostname;
    const matched = cookies.find(c => c.domain.includes(currentHost));
    if (matched) return matched.value;
    return cookies[0].value;
  } catch {
    return null;
  }
}

let isConnecting = false;
let reconnectTimer = null;
let cachedApiKey = null;
let currentUser = null;

// Dynamic Extension Action behavior:
// - If user is logged in: clicking the extension redirects immediately to dashboard.
// - If user is NOT logged in: clicking the extension shows popup with "Log In".
function updateActionBehavior(isLoggedIn) {
  if (typeof chrome === 'undefined' || !chrome.action) return;
  if (isLoggedIn) {
    chrome.action.setPopup({ popup: '' });
    chrome.action.setTitle({ title: 'Mail Track — Open Dashboard' });
  } else {
    chrome.action.setPopup({ popup: 'popup.html' });
    chrome.action.setTitle({ title: 'Mail Track — Log In' });
  }
}

function openOrFocusDashboard() {
  const dashUrl = (cachedConfig && cachedConfig.publicUrl) || activeServerUrl || PROD_SERVER_URL;
  chrome.tabs.query({}, (tabs) => {
    const existing = tabs.find(t => {
      if (!t.url) return false;
      return t.url.includes('mail-track-pink.vercel.app') ||
             t.url.includes('vercel.app') ||
             t.url.startsWith('http://localhost:4000');
    });

    if (existing && existing.id) {
      chrome.tabs.update(existing.id, { active: true });
      if (existing.windowId) {
        chrome.windows.update(existing.windowId, { focused: true });
      }
    } else {
      chrome.tabs.create({ url: `${dashUrl}/` });
    }
  });
}

// When popup is disabled (user is logged in), clicking the toolbar extension icon fires this event
if (typeof chrome !== 'undefined' && chrome.action && chrome.action.onClicked) {
  chrome.action.onClicked.addListener((tab) => {
    if (currentUser && currentUser.email) {
      openOrFocusDashboard();
    } else {
      chrome.action.setPopup({ popup: 'popup.html' });
      if (chrome.action.openPopup) {
        chrome.action.openPopup().catch(() => {
          chrome.tabs.create({ url: `${activeServerUrl}/login` });
        });
      } else {
        chrome.tabs.create({ url: `${activeServerUrl}/login` });
      }
    }
  });
}

// Initialize auth from persistent extension storage
if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
  chrome.storage.local.get(['mt_user', 'mt_api_key'], (items) => {
    if (items.mt_user) currentUser = items.mt_user;
    if (items.mt_api_key) cachedApiKey = items.mt_api_key;
    if (currentUser) {
      console.log('[MailTrack BG] Loaded cached user from storage:', currentUser.email);
      updateActionBehavior(true);
    } else {
      updateActionBehavior(false);
    }
  });
}

// Sync authenticated user from server with throttling & deduplication
let lastSyncAuthTime = 0;
let syncAuthPromise = null;

async function syncAuth() {
  const now = Date.now();
  if (syncAuthPromise) return syncAuthPromise;
  if (now - lastSyncAuthTime < 2500) {
    return !!cachedApiKey;
  }
  lastSyncAuthTime = now;

  syncAuthPromise = (async () => {
    try {
      await probeAndSetActiveServer();
      const serverUrl = activeServerUrl;
      const headers = {};
      if (cachedApiKey) headers['X-API-Key'] = cachedApiKey;
      const token = await getAuthTokenCookie();
      if (token && !headers['Authorization']) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const res = await fetch(`${serverUrl}/auth/me`, { 
        credentials: 'include',
        headers
      });

      // Never wipe credentials if rate limited or server error
      if (res.status === 429) {
        console.warn('[MailTrack BG] /auth/me rate limited, retaining existing auth');
        return !!cachedApiKey;
      }
      if (!res.ok) {
        return !!cachedApiKey;
      }

      const data = await res.json();
      if (data && data.authenticated && data.user) {
        cachedApiKey = data.user.apiKey;
        currentUser = data.user;
        chrome.storage.local.set({ mt_user: data.user, mt_api_key: data.user.apiKey });
        console.log('[MailTrack BG] Authenticated as:', currentUser.email);
        updateActionBehavior(true);
        if (ws && ws.readyState === WebSocket.OPEN && cachedApiKey) {
          try {
            ws.send(JSON.stringify({ type: 'AUTH', token: cachedApiKey }));
          } catch {}
        }
        broadcastToGmailTabs({ type: 'AUTH_UPDATED', user: currentUser });
        return true;
      } else if (data && data.authenticated === false) {
        console.log('[MailTrack BG] Not authenticated on server');
        cachedApiKey = null;
        currentUser = null;
        chrome.storage.local.remove(['mt_user', 'mt_api_key']);
        updateActionBehavior(false);
        broadcastToGmailTabs({ type: 'AUTH_UPDATED', user: null });
        return false;
      }
      return !!cachedApiKey;
    } catch (err) {
      return !!cachedApiKey;
    } finally {
      syncAuthPromise = null;
    }
  })();

  return syncAuthPromise;
}

// Observe mt_token cookie changes across mailtrack.in, vercel.app, and localhost
if (typeof chrome !== 'undefined' && chrome.cookies && chrome.cookies.onChanged) {
  let cookieDebounce = null;
  chrome.cookies.onChanged.addListener((changeInfo) => {
    if (changeInfo.cookie && changeInfo.cookie.name === 'mt_token') {
      const domain = changeInfo.cookie.domain || '';
      if (domain.includes('mailtrack.in') || domain.includes('vercel.app') || domain.includes('localhost')) {
        console.log('[MailTrack BG] Auth token cookie change detected on', domain, 'removed:', changeInfo.removed);
        clearTimeout(cookieDebounce);
        cookieDebounce = setTimeout(() => {
          syncAuth();
        }, 500);
      }
    }
  });
}

// Check if tracking server is responsive
async function checkServerReady() {
  try {
    await probeAndSetActiveServer();
    const res = await fetch(`${activeServerUrl}/api/config`, { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      if (data && data.success) {
        cachedConfig = data;
        return true;
      }
    }
  } catch (e) {
    // Handled silently
  }
  return false;
}

// 1. Fetch server config
async function updateConfig() {
  try {
    const serverUrl = await getActiveServerUrl();
    const res = await fetch(`${serverUrl}/api/config`, { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      if (data.success) {
        cachedConfig = data;
        console.log('[MailTrack BG] Updated server config:', cachedConfig);
      }
    }
  } catch (e) {
    // Handled silently
  }
}

// 2. Connect WebSocket safely if server supports it (with automatic fallback on serverless)
async function safeConnectWS() {
  if (isConnecting) return;
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  isConnecting = true;
  try {
    const ready = await checkServerReady();
    if (!ready) {
      isConnecting = false;
      scheduleReconnect();
      return;
    }

    const wsProto = activeServerUrl.startsWith('https:') ? 'wss:' : 'ws:';
    const wsHost = activeServerUrl.replace(/^https?:\/\//, '');
    const authQuery = cachedApiKey ? `?apiKey=${encodeURIComponent(cachedApiKey)}` : '';
    const socket = new WebSocket(`${wsProto}//${wsHost}${authQuery}`);
    ws = socket;

    socket.onopen = () => {
      isConnecting = false;
      console.log('[MailTrack BG] WebSocket connected to tracking backend');
      if (cachedApiKey) {
        try {
          socket.send(JSON.stringify({ type: 'AUTH', token: cachedApiKey }));
        } catch {}
      }
    };

    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        handleServerEvent(payload);
      } catch (e) {
        console.error('Failed to parse WS payload', e);
      }
    };

    socket.onclose = () => {
      if (ws === socket) {
        ws = null;
      }
      isConnecting = false;
      scheduleReconnect();
    };

    socket.onerror = () => {
      try {
        socket.close();
      } catch (e) {}
    };
  } catch (err) {
    isConnecting = false;
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    safeConnectWS();
  }, reconnectInterval);
}

function formatDeviceDisplay(client) {
  if (!client) return 'Read via Gmail (Google Proxy)';
  const c = String(client).trim();
  if (/Google Proxy|Gmail|Desktop/i.test(c)) return 'Read via Gmail (Google Proxy)';
  if (/iPhone/i.test(c)) return 'Read on iPhone';
  if (/iPad/i.test(c)) return 'Read on iPad';
  if (/Android/i.test(c)) return 'Read on Android';
  if (/Macintosh|Mac OS/i.test(c)) return 'Read on Mac';
  if (/Windows/i.test(c)) return 'Read on Windows';
  return c;
}

// Handle real-time push events from server
function handleServerEvent(payload) {
  if (!payload || !payload.type) return;
  const { type, data } = payload;
  if (!data) return;

  // Multi-user isolation
  const eventEmail = data.email || null;
  const eventUserId = (eventEmail && eventEmail.userId) || data.userId || null;
  if (currentUser && currentUser.id && eventUserId && eventUserId !== currentUser.id) {
    return;
  }

  if (type === 'EMAIL_OPENED') {
    const rawDevice = data.client || (data.open && data.open.client) || 'Gmail (Google Proxy)';
    const displayDevice = formatDeviceDisplay(rawDevice);

    const emailSubject = (data.email && data.email.subject) || 'Your email';
    const recipient = (data.email && data.email.recipient) || 'Recipient';
    const openCount = (data.email && data.email.openCount) || 1;

    let notifBody = `${recipient} just opened your email "${emailSubject}"`;
    if (openCount > 1) {
      notifBody += ` (${openCount} opens)`;
    }
    notifBody += ` • ${displayDevice}`;

    if (typeof chrome !== 'undefined' && chrome.notifications) {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon-128.png',
        title: 'Email Opened! ✓✓',
        message: notifBody,
        priority: 2
      });
    }

    broadcastToGmailTabs({ type: 'EMAIL_OPENED', data });
  }

  if (type === 'LINK_CLICKED') {
    const emailSubject = (data.email && data.email.subject) || 'Your email';
    const targetUrl = (data.click && data.click.targetUrl) || 'a link';

    if (typeof chrome !== 'undefined' && chrome.notifications) {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon-128.png',
        title: 'Link Clicked! 🔗',
        message: `Recipient clicked ${targetUrl} in "${emailSubject}"`,
        priority: 2
      });
    }

    broadcastToGmailTabs({ type: 'LINK_CLICKED', data });
  }

  if (type === 'EMAIL_CREATED') {
    broadcastToGmailTabs({ type: 'EMAIL_CREATED', data });
  }

  if (type === 'CONFIG_UPDATED') {
    if (data.publicUrl) {
      cachedConfig.publicUrl = data.publicUrl;
      broadcastToGmailTabs({ type: 'CONFIG_UPDATED', config: cachedConfig });
    }
  }
}

function broadcastToGmailTabs(message) {
  if (typeof chrome === 'undefined' || !chrome.tabs) return;
  chrome.tabs.query({ url: '*://mail.google.com/*' }, (tabs) => {
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, message).catch(() => {});
    }
  });
}

// Universal link protector
if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.onUpdated) {
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.url && changeInfo.url.includes('/trace/link')) {
      try {
        const u = new URL(changeInfo.url);
        const targetUrl = u.searchParams.get('url');
        const emailId = u.pathname.split('/trace/link/')[1] || u.searchParams.get('id');

        const activePublic = cachedConfig && cachedConfig.publicUrl;
        const isLocal = u.origin === 'http://localhost:4000';
        const isActiveCurrent = activePublic && u.origin === activePublic;
        const isActiveDomain = u.origin.includes('mailtrack.in') || u.origin.includes('vercel.app');

        if (!isLocal && !isActiveCurrent && !isActiveDomain && targetUrl) {
          console.log('[MailTrack BG] Rescuing click on legacy/offline link:', u.origin);
          const rerouted = `${activeServerUrl}/trace/link/${emailId || ''}?url=${encodeURIComponent(targetUrl)}`;
          chrome.tabs.update(tabId, { url: rerouted });
        }
      } catch (e) {}
    }
  });
}

// External message listener (from web pages on mailtrack.in or vercel.app)
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessageExternal) {
  chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
    if (message && (message.type === 'MAILTRACK_AUTH_SUCCESS' || message.action === 'AUTH_SUCCESS_BRIDGE')) {
      console.log('[MailTrack BG] External auth received for:', message.email);
      if (message.apiKey) cachedApiKey = message.apiKey;
      syncAuth().then((isAuth) => sendResponse({ success: true, authenticated: isAuth }));
      return true;
    }
  });
}

// Initialize
probeAndSetActiveServer().then(() => {
  updateConfig();
  syncAuth();
  safeConnectWS();
});

// 3. Message listener for content scripts & popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'AUTH_SUCCESS_BRIDGE') {
    if (request.apiKey) cachedApiKey = request.apiKey;
    syncAuth().then((isAuth) => {
      sendResponse({ success: true, authenticated: isAuth });
    });
    return true;
  }

  if (request.action === 'SET_SERVER_MODE') {
    const newMode = request.mode === 'localhost' ? 'localhost' : 'production';
    serverMode = newMode;
    activeServerUrl = newMode === 'localhost' ? LOCAL_SERVER_URL : PROD_SERVER_URL;
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({
        mt_server_mode: newMode,
        mt_active_server_url: activeServerUrl
      });
    }
    cachedConfig = {
      localUrl: LOCAL_SERVER_URL,
      publicUrl: activeServerUrl
    };
    console.log('[MailTrack BG] Server mode switched to:', newMode, 'URL:', activeServerUrl);

    // Notify all Gmail content scripts of the updated tracking URL
    broadcastToGmailTabs({
      type: 'CONFIG_UPDATED',
      config: { publicUrl: activeServerUrl },
      serverMode: newMode,
      activeServerUrl
    });

    syncAuth().then((isAuth) => {
      sendResponse({ success: true, mode: newMode, activeServerUrl, authenticated: isAuth });
    });
    return true;
  }

  if (request.action === 'GET_CONFIG') {
    getActiveServerUrl().then(() => {
      updateConfig().then(() => {
        sendResponse({ success: true, config: cachedConfig, user: currentUser, activeServerUrl, serverMode });
      }).catch(() => {
        sendResponse({ success: true, config: cachedConfig, user: currentUser, activeServerUrl, serverMode });
      });
    });
    return true;
  }

  if (request.action === 'REDIRECT_DASHBOARD') {
    openOrFocusDashboard();
    sendResponse({ success: true });
    return true;
  }

  if (request.action === 'OPEN_LOGIN') {
    const sUrl = activeServerUrl || PROD_SERVER_URL;
    chrome.tabs.create({ url: `${sUrl}/login` });
    sendResponse({ success: true });
    return true;
  }

  if (request.action === 'GET_AUTH_STATUS' || request.action === 'SYNC_AUTH') {
    syncAuth().then((isAuth) => {
      sendResponse({ authenticated: isAuth, user: currentUser, apiKey: cachedApiKey, activeServerUrl });
    });
    return true;
  }

  if (request.action === 'CREATE_TRACKED_EMAIL') {
    (async () => {
      await getActiveServerUrl();
      const headers = { 'Content-Type': 'application/json' };
      const sender = request.payload && request.payload.sender;
      if (sender && sender.includes('@')) {
        headers['X-MailTrack-User-Email'] = sender;
      }
      if (cachedApiKey && (!sender || (currentUser && currentUser.email === sender))) {
        headers['X-API-Key'] = cachedApiKey;
      }

      try {
        let res = await fetch(`${activeServerUrl}/api/emails`, {
          method: 'POST',
          headers,
          body: JSON.stringify(request.payload)
        });
        if (!res.ok && activeServerUrl !== PROD_SERVER_URL) {
          res = await fetch(`${PROD_SERVER_URL}/api/emails`, {
            method: 'POST',
            headers,
            body: JSON.stringify(request.payload)
          });
        }
        const data = await res.json();
        sendResponse({ success: true, data });
      } catch (err) {
        if (activeServerUrl !== PROD_SERVER_URL) {
          try {
            const fallbackRes = await fetch(`${PROD_SERVER_URL}/api/emails`, {
              method: 'POST',
              headers,
              body: JSON.stringify(request.payload)
            });
            const data = await fallbackRes.json();
            return sendResponse({ success: true, data });
          } catch {}
        }
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  if (request.action === 'BIND_THREAD_ID') {
    (async () => {
      await getActiveServerUrl();
      const headers = { 'Content-Type': 'application/json' };
      if (cachedApiKey) headers['X-API-Key'] = cachedApiKey;

      try {
        let res = await fetch(`${activeServerUrl}/api/emails/${encodeURIComponent(request.emailId)}/thread`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ threadId: request.threadId, messageId: request.messageId })
        });
        if (!res.ok && activeServerUrl !== PROD_SERVER_URL) {
          res = await fetch(`${PROD_SERVER_URL}/api/emails/${encodeURIComponent(request.emailId)}/thread`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ threadId: request.threadId, messageId: request.messageId })
          });
        }
        const data = await res.json();
        sendResponse(data);
      } catch (err) {
        if (activeServerUrl !== PROD_SERVER_URL) {
          try {
            const fbRes = await fetch(`${PROD_SERVER_URL}/api/emails/${encodeURIComponent(request.emailId)}/thread`, {
              method: 'POST',
              headers,
              body: JSON.stringify({ threadId: request.threadId, messageId: request.messageId })
            });
            return sendResponse(await fbRes.json());
          } catch {}
        }
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  if (request.action === 'GET_TRACKED_EMAILS') {
    (async () => {
      await getActiveServerUrl();

      // 1. If cachedApiKey not in memory, await storage
      if (!cachedApiKey && typeof chrome !== 'undefined' && chrome.storage?.local) {
        await new Promise(resolve => {
          chrome.storage.local.get(['mt_user', 'mt_api_key'], (items) => {
            if (items.mt_user) currentUser = items.mt_user;
            if (items.mt_api_key) cachedApiKey = items.mt_api_key;
            resolve();
          });
        });
      }

      // 2. Prepare headers & query
      const activeEmail = request.email || (currentUser && currentUser.email) || null;
      const headers = {};
      if (cachedApiKey && (!activeEmail || (currentUser && currentUser.email === activeEmail))) {
        headers['X-API-Key'] = cachedApiKey;
      }
      if (activeEmail) headers['X-MailTrack-User-Email'] = activeEmail;

      const url = activeEmail 
        ? `${activeServerUrl}/api/emails?email=${encodeURIComponent(activeEmail)}`
        : `${activeServerUrl}/api/emails`;

      try {
        const res = await fetch(url, { headers });
        const data = await res.json();
        if (data && data.success && data.user) {
          cachedApiKey = data.user.apiKey;
          currentUser = data.user;
          if (typeof chrome !== 'undefined' && chrome.storage?.local) {
            chrome.storage.local.set({ mt_user: data.user, mt_api_key: data.user.apiKey });
          }
          if (ws && ws.readyState === WebSocket.OPEN && cachedApiKey) {
            try { ws.send(JSON.stringify({ type: 'AUTH', token: cachedApiKey })); } catch {}
          }
        }
        sendResponse(data);
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }
});
