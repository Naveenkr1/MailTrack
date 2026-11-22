// Popup Script for Mail Track
document.addEventListener('DOMContentLoaded', async () => {
  const loggedOutView = document.getElementById('loggedOutView');
  const loggedInView = document.getElementById('loggedInView');
  const loadingView = document.getElementById('loadingView');
  const serverStatus = document.getElementById('serverStatus');
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
    chrome.storage.local.get(['mt_user', 'mt_api_key'], (items) => {
      if (items.mt_user && items.mt_user.email) {
        handleLoggedIn(items.mt_user);
      } else {
        showView('loading');
      }
    });
  }

  // 2. Fetch fresh auth status from tracking server
  try {
    const sUrl = await getServerUrl();
    const res = await fetch(`${sUrl}/auth/me`, { 
      credentials: 'include' 
    });
    
    if (serverStatus) {
      serverStatus.textContent = 'Online';
      serverStatus.className = 'status-pill connected';
    }

    if (res.status === 429) {
      chrome.storage.local.get(['mt_user'], (items) => {
        if (items.mt_user && items.mt_user.email) {
          handleLoggedIn(items.mt_user);
        } else {
          handleLoggedOut();
        }
      });
      return;
    }

    if (res.ok) {
      const auth = await res.json();
      if (auth.authenticated && auth.user) {
        chrome.storage.local.set({ mt_user: auth.user, mt_api_key: auth.user.apiKey });
        handleLoggedIn(auth.user);
      } else if (auth.authenticated === false) {
        chrome.storage.local.remove(['mt_user', 'mt_api_key']);
        handleLoggedOut();
      }
    } else {
      chrome.storage.local.get(['mt_user'], (items) => {
        if (items.mt_user && items.mt_user.email) {
          handleLoggedIn(items.mt_user);
        } else {
          handleLoggedOut();
        }
      });
    }
  } catch (err) {
    if (serverStatus) {
      serverStatus.textContent = 'Offline';
      serverStatus.className = 'status-pill offline';
    }
    chrome.storage.local.get(['mt_user'], (items) => {
      if (items.mt_user && items.mt_user.email) {
        handleLoggedIn(items.mt_user);
      } else {
        handleLoggedOut();
      }
    });
  }

  // 3. Listen for storage changes in real time
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.mt_user) {
        if (changes.mt_user.newValue) {
          handleLoggedIn(changes.mt_user.newValue);
        } else {
          handleLoggedOut();
        }
      }
    });
  }

  // 4. Action Button Handlers
  if (loginBtn) {
    loginBtn.onclick = async () => {
      const sUrl = await getServerUrl();
      chrome.tabs.create({ url: `${sUrl}/auth/google?flow_src=extension` });
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

      const sUrl = await getServerUrl();
      try {
        await fetch(`${sUrl}/auth/logout`, {
          method: 'POST',
          credentials: 'include'
        }).catch(() => {});
      } catch {}

      chrome.runtime.sendMessage({ action: 'LOGOUT' }, () => {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          chrome.storage.local.remove(['mt_user', 'mt_api_key'], () => {
            handleLoggedOut();
          });
        } else {
          handleLoggedOut();
        }
      });
    };
  }

  // 5. Host Environment Switcher (Cloud vs Localhost)
  const envProdBtn = document.getElementById('envProdBtn');
  const envLocalBtn = document.getElementById('envLocalBtn');

  function updateEnvUI(mode) {
    if (!envProdBtn || !envLocalBtn) return;
    if (mode === 'localhost') {
      envLocalBtn.classList.add('active');
      envProdBtn.classList.remove('active');
    } else {
      envProdBtn.classList.add('active');
      envLocalBtn.classList.remove('active');
    }
  }

  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(['mt_server_mode'], (items) => {
      updateEnvUI(items.mt_server_mode || 'production');
    });
  }

  if (envProdBtn) {
    envProdBtn.onclick = () => {
      updateEnvUI('production');
      chrome.runtime.sendMessage({ action: 'SET_SERVER_MODE', mode: 'production' }, () => {
        window.location.reload();
      });
    };
  }

  if (envLocalBtn) {
    envLocalBtn.onclick = () => {
      updateEnvUI('localhost');
      chrome.runtime.sendMessage({ action: 'SET_SERVER_MODE', mode: 'localhost' }, () => {
        window.location.reload();
      });
    };
  }
});
