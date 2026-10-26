// Background Service Worker for Mail Track
let ws = null;
let reconnectInterval = 3000;
let cachedConfig = {
  localUrl: 'http://localhost:4000',
  publicUrl: 'http://localhost:4000'
};

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
  const dashUrl = (cachedConfig && cachedConfig.localUrl) || 'http://localhost:4000';
  chrome.tabs.query({}, (tabs) => {
    const existing = tabs.find(t => {
      if (!t.url) return false;
      return t.url.startsWith('http://localhost:4000') ||
             (cachedConfig && cachedConfig.publicUrl && t.url.startsWith(cachedConfig.publicUrl));
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
          chrome.tabs.create({ url: 'http://localhost:4000/login' });
        });
      } else {
        chrome.tabs.create({ url: 'http://localhost:4000/login' });
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
      const headers = {};
      if (cachedApiKey) headers['X-API-Key'] = cachedApiKey;
      const res = await fetch('http://localhost:4000/auth/me', { 
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

// Observe ONLY mt_token cookie changes on localhost:4000 (NEVER mt_sender)
if (typeof chrome !== 'undefined' && chrome.cookies && chrome.cookies.onChanged) {
  let cookieDebounce = null;
  chrome.cookies.onChanged.addListener((changeInfo) => {
    if (changeInfo.cookie && changeInfo.cookie.name === 'mt_token') {
      console.log('[MailTrack BG] Auth token cookie change detected, removed:', changeInfo.removed);
      clearTimeout(cookieDebounce);
      cookieDebounce = setTimeout(() => {
        syncAuth();
      }, 500);
    }
  });
}

// Check if local server is responsive before opening WebSocket
async function checkServerReady() {
  try {
    const res = await fetch('http://localhost:4000/api/config', { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      if (data && data.success) {
        cachedConfig = data;
        return true;
      }
    }
  } catch (e) {
    // Handled silently: server not yet running or restarting
  }
  return false;
}

// 1. Fetch server config
async function updateConfig() {
  try {
    const res = await fetch('http://localhost:4000/api/config', { cache: 'no-store' });
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

// 2. Connect WebSocket safely without ERR_CONNECTION_REFUSED
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

    const authQuery = cachedApiKey ? `?apiKey=${encodeURIComponent(cachedApiKey)}` : '';
    const socket = new WebSocket(`ws://localhost:4000${authQuery}`);
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
  if (/Mac/i.test(c)) return 'Read on Mac';
  if (/Windows/i.test(c)) return 'Read on Windows PC';
  if (/Linux/i.test(c)) return 'Read on Linux PC';
  return `Read via ${c}`;
}

function formatDeviceName(client) {
  if (!client) return 'Gmail (Google Proxy)';
  const c = String(client).trim();
  if (/Google Proxy|Gmail|Desktop/i.test(c)) return 'Gmail (Google Proxy)';
  if (/iPhone/i.test(c)) return 'iPhone';
  if (/iPad/i.test(c)) return 'iPad';
  if (/Android/i.test(c)) return 'Android';
  if (/Mac/i.test(c)) return 'Mac';
  if (/Windows/i.test(c)) return 'Windows PC';
  if (/Linux/i.test(c)) return 'Linux PC';
  return c;
}

function handleServerEvent(payload) {
  if (!payload || !payload.type) return;
  const { type, data } = payload;
  if (!data) return;

  // Enforce account isolation: ignore notifications for other user profiles
  const eventEmail = data.email || null;
  const eventUserId = (eventEmail && eventEmail.userId) || data.userId || null;
  if (currentUser && currentUser.id && eventUserId && eventUserId !== currentUser.id) {
    return;
  }

  if (type === 'EMAIL_OPENED') {
    const { email, event } = data;
    if (currentUser && email && email.userId && currentUser.id !== email.userId) {
      return;
    }

    const deviceDisplay = formatDeviceDisplay(event.client);
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon-128.png',
      title: '✓✓ Email Opened!',
      message: `"${email.subject}" was just read by ${email.recipient} (${deviceDisplay})`,
      priority: 2
    });

    broadcastToGmailTabs({ type: 'EMAIL_OPENED', emailId: email.id, email });
  } else if (type === 'LINK_CLICKED') {
    const { email, event } = data;
    if (currentUser && email && email.userId && currentUser.id !== email.userId) {
      return;
    }

    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon-128.png',
      title: '↗ Link Clicked!',
      message: `A link in "${email ? email.subject : 'email'}" was clicked (${event.url})`,
      priority: 1
    });

    broadcastToGmailTabs({ type: 'LINK_CLICKED', emailId: email ? email.id : null });
  } else if (type === 'CONFIG_UPDATED') {
    updateConfig().then(() => {
      broadcastToGmailTabs({ type: 'CONFIG_UPDATED', config: cachedConfig });
    });
  }
}

function broadcastToGmailTabs(message) {
  chrome.tabs.query({ url: 'https://mail.google.com/*' }, (tabs) => {
    tabs.forEach((tab) => {
      chrome.tabs.sendMessage(tab.id, message).catch(() => {});
    });
  });
}

// Universal link protector: if any tab navigates to a tracked link with a stale/dead tunnel domain,
// immediately rescue it by rerouting to localhost:4000 so the click tracks and destination opens!
if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.onUpdated) {
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.url && changeInfo.url.includes('/trace/link')) {
      try {
        const u = new URL(changeInfo.url);
        const targetUrl = u.searchParams.get('url');
        const emailId = u.pathname.split('/trace/link/')[1] || u.searchParams.get('id');

        const activePublic = cachedConfig && cachedConfig.publicUrl;
        const isLocal = u.origin === 'http://localhost:4000';
        const isActiveTunnel = activePublic && u.origin === activePublic;

        if (!isLocal && !isActiveTunnel && targetUrl) {
          console.log('[MailTrack BG] Rescuing click on legacy/offline link:', u.origin);
          const rerouted = `http://localhost:4000/trace/link/${emailId || ''}?url=${encodeURIComponent(targetUrl)}`;
          chrome.tabs.update(tabId, { url: rerouted });
        }
      } catch (e) {}
    }
  });
}

// Initialize
updateConfig();
syncAuth();
safeConnectWS();

// 3. Message listener for content scripts & popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'GET_CONFIG') {
    updateConfig().then(() => {
      sendResponse({ success: true, config: cachedConfig, user: currentUser });
    }).catch(() => {
      sendResponse({ success: true, config: cachedConfig, user: currentUser });
    });
    return true;
  }

  if (request.action === 'REDIRECT_DASHBOARD') {
    openOrFocusDashboard();
    sendResponse({ success: true });
    return true;
  }

  if (request.action === 'OPEN_LOGIN') {
    chrome.tabs.create({ url: 'http://localhost:4000/login' });
    sendResponse({ success: true });
    return true;
  }

  if (request.action === 'GET_AUTH_STATUS' || request.action === 'SYNC_AUTH') {
    syncAuth().then((isAuth) => {
      sendResponse({ authenticated: isAuth, user: currentUser, apiKey: cachedApiKey });
    });
    return true;
  }

  if (request.action === 'CREATE_TRACKED_EMAIL') {
    const headers = { 'Content-Type': 'application/json' };
    if (cachedApiKey) headers['X-API-Key'] = cachedApiKey;

    fetch('http://localhost:4000/api/emails', {
      method: 'POST',
      headers,
      body: JSON.stringify(request.payload)
    })
      .then(res => res.json())
      .then(data => sendResponse({ success: true, data }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.action === 'BIND_THREAD_ID') {
    const headers = { 'Content-Type': 'application/json' };
    if (cachedApiKey) headers['X-API-Key'] = cachedApiKey;

    fetch(`http://localhost:4000/api/emails/${encodeURIComponent(request.emailId)}/thread`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ threadId: request.threadId, messageId: request.messageId })
    })
      .then(res => res.json())
      .then(data => sendResponse(data))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.action === 'GET_TRACKED_EMAILS') {
    (async () => {
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
      if (cachedApiKey) headers['X-API-Key'] = cachedApiKey;
      if (activeEmail) headers['X-MailTrack-User-Email'] = activeEmail;

      const url = activeEmail 
        ? `http://localhost:4000/api/emails?email=${encodeURIComponent(activeEmail)}`
        : 'http://localhost:4000/api/emails';

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
