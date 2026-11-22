// Popup Script for Mail Track
document.addEventListener('DOMContentLoaded', async () => {
  const loggedOutView = document.getElementById('loggedOutView');
  const loggedInView = document.getElementById('loggedInView');
  const loadingView = document.getElementById('loadingView');
  const loginBtn = document.getElementById('loginBtn');
  const openDashboardBtn = document.getElementById('openDashboardBtn');
  const openGmailBtn = document.getElementById('openGmailBtn');
  const logoutBtn = document.getElementById('logoutBtn');
  const userNameEl = document.getElementById('userName');
  const userEmailEl = document.getElementById('userEmail');
  const userAvatarEl = document.getElementById('userAvatar');

  const DEFAULT_PROD_URL = 'https://mailtrack.in';
  const LOCAL_URL = 'http://localhost:4000';

  async function getServerUrl() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      const items = await chrome.storage.local.get(['mt_server_mode', 'mt_active_server_url', 'mt_custom_server_url']);
      if (items.mt_custom_server_url && !items.mt_custom_server_url.includes('trycloudflare.com')) {
        return items.mt_custom_server_url.replace(/\/+$/, '');
      }
      if (items.mt_server_mode === 'localhost') return LOCAL_URL;
      if (items.mt_active_server_url && !items.mt_active_server_url.includes('trycloudflare.com')) {
        return items.mt_active_server_url.replace(/\/+$/, '');
      }
    }
    return DEFAULT_PROD_URL;
  }

  function showView(view) {
    if (loadingView) loadingView.style.display = (view === 'loading') ? 'block' : 'none';
    if (loggedOutView) loggedOutView.style.display = (view === 'loggedOut') ? 'block' : 'none';
    if (loggedInView) loggedInView.style.display = (view === 'loggedIn') ? 'block' : 'none';
  }

  function handleLoggedIn(user) {
    showView('loggedIn');
    if (userNameEl && user) {
      userNameEl.textContent = user.name || (user.email ? user.email.split('@')[0] : 'User');
    }
    if (userEmailEl && user) {
      userEmailEl.textContent = user.email || 'Connected Account';
    }
    if (userAvatarEl && user) {
      const pic = user.avatarUrl || user.picture;
      if (pic) {
        userAvatarEl.innerHTML = `<img src="${pic}" alt="" style="width:100%;height:100%;border-radius:50%;object-fit:cover;" />`;
      } else {
        const initial = ((user.name || user.email || 'U')[0]).toUpperCase();
        userAvatarEl.textContent = initial;
      }
    }
  }

  function handleLoggedOut() {
    showView('loggedOut');
    if (logoutBtn) {
      logoutBtn.disabled = false;
      logoutBtn.style.opacity = '1';
      logoutBtn.innerHTML = `
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
          <polyline points="16 17 21 12 16 7"></polyline>
          <line x1="21" y1="12" x2="9" y2="12"></line>
        </svg>
        <span>Log Out</span>
      `;
    }
  }

  // 1. Check local extension storage first for immediate rendering
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(['mt_user', 'mt_api_key', 'mt_is_logged_out'], (items) => {
      if (items && items.mt_is_logged_out) {
        handleLoggedOut();
        return;
      }
      if (items && items.mt_user && items.mt_user.email) {
        handleLoggedIn(items.mt_user);
      } else {
        showView('loading');
      }
    });
  }

  // 2. Fetch fresh auth status via background service worker (handles cookies, tokens, and storage)
  try {
    chrome.runtime.sendMessage({ action: 'GET_AUTH_STATUS' }, (res) => {
      if (chrome.runtime.lastError || !res) return;
      if (res.authenticated && res.user) {
        handleLoggedIn(res.user);
      } else if (res.authenticated === false) {
        handleLoggedOut();
      }
    });
  } catch (err) {}

  // 3. Listen for storage changes in real time
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local') {
        if (changes.mt_is_logged_out?.newValue) {
          handleLoggedOut();
        } else if (changes.mt_user?.newValue) {
          handleLoggedIn(changes.mt_user.newValue);
        } else if (changes.mt_user && !changes.mt_user.newValue) {
          handleLoggedOut();
        }
      }
    });
  }

  // 4. Action Button Handlers
  if (loginBtn) {
    loginBtn.onclick = async () => {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        await chrome.storage.local.remove(['mt_is_logged_out']);
      }
      try {
        chrome.runtime.sendMessage({ action: 'CLEAR_LOGGED_OUT_STATE' });
      } catch {}
      const sUrl = await getServerUrl();
      chrome.tabs.create({ url: `${sUrl}/login` });
      window.close();
    };
  }

  if (openDashboardBtn) {
    openDashboardBtn.onclick = async () => {
      const sUrl = await getServerUrl();
      chrome.runtime.sendMessage({ action: 'REDIRECT_DASHBOARD' }, (res) => {
        if (chrome.runtime.lastError || !res) {
          chrome.tabs.create({ url: `${sUrl}/` });
        }
        window.close();
      });
    };
  }

  if (openGmailBtn) {
    openGmailBtn.onclick = () => {
      chrome.tabs.query({}, (tabs) => {
        const gmailTab = tabs.find(t => t.url && t.url.includes('mail.google.com'));
        if (gmailTab && gmailTab.id) {
          chrome.tabs.update(gmailTab.id, { active: true });
          if (gmailTab.windowId) {
            chrome.windows.update(gmailTab.windowId, { focused: true });
          }
        } else {
          chrome.tabs.create({ url: 'https://mail.google.com/' });
        }
        window.close();
      });
    };
  }

  if (logoutBtn) {
    logoutBtn.onclick = async () => {
      logoutBtn.disabled = true;
      logoutBtn.style.opacity = '0.7';
      logoutBtn.innerHTML = `
        <div class="spinner-sm"></div>
        <span>Logging out...</span>
      `;

      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        await chrome.storage.local.set({ mt_is_logged_out: true });
        await chrome.storage.local.remove(['mt_user', 'mt_api_key']);
      }

      const sUrl = await getServerUrl();
      try {
        await fetch(`${sUrl}/auth/logout`, {
          method: 'POST',
          credentials: 'include'
        }).catch(() => {});
      } catch {}

      chrome.runtime.sendMessage({ action: 'LOGOUT' }, () => {
        handleLoggedOut();
      });
    };
  }
});
