// Popup Script for Mail Track
document.addEventListener('DOMContentLoaded', async () => {
  const loggedOutView = document.getElementById('loggedOutView');
  const loggedInView = document.getElementById('loggedInView');
  const loadingView = document.getElementById('loadingView');
  const serverStatus = document.getElementById('serverStatus');
  const loginBtn = document.getElementById('loginBtn');
  const openDashboardBtn = document.getElementById('openDashboardBtn');
  const userEmailEl = document.getElementById('userEmail');
  const userAvatarEl = document.getElementById('userAvatar');

  const DEFAULT_PROD_URL = 'https://mail-track-pink.vercel.app';
  const LOCAL_URL = 'http://localhost:4000';

  let isRedirecting = false;

  async function getServerUrl() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      const items = await chrome.storage.local.get(['mt_server_mode', 'mt_active_server_url', 'mt_custom_server_url']);
      if (items.mt_custom_server_url) return items.mt_custom_server_url.replace(/\/+$/, '');
      if (items.mt_server_mode === 'localhost') return LOCAL_URL;
      if (items.mt_active_server_url) return items.mt_active_server_url.replace(/\/+$/, '');
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
    if (userEmailEl && user) {
      userEmailEl.textContent = user.email || 'Connected Account';
    }
    if (userAvatarEl && user) {
      if (user.avatarUrl || user.picture) {
        userAvatarEl.innerHTML = `<img src="${user.avatarUrl || user.picture}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;" />`;
      } else {
        userAvatarEl.textContent = ((user.name || user.email || 'U')[0]).toUpperCase();
      }
    }

    if (!isRedirecting) {
      isRedirecting = true;
      redirectToDashboard();
    }
  }

  function handleLoggedOut() {
    isRedirecting = false;
    showView('loggedOut');
  }

  async function redirectToDashboard() {
    const sUrl = await getServerUrl();
    // Notify background worker to focus or open dashboard tab
    chrome.runtime.sendMessage({ action: 'REDIRECT_DASHBOARD' }, (res) => {
      if (chrome.runtime.lastError || !res) {
        chrome.tabs.create({ url: `${sUrl}/` });
      }
      setTimeout(() => {
        window.close();
      }, 150);
    });
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
      console.warn('[MailTrack Popup] Rate limited on /auth/me, keeping cached session');
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
    }
  } catch (err) {
    if (serverStatus) {
      serverStatus.textContent = 'Offline';
      serverStatus.className = 'status-pill offline';
    }
    // If server is unreachable, check storage again
    chrome.storage.local.get(['mt_user'], (items) => {
      if (items.mt_user && items.mt_user.email) {
        handleLoggedIn(items.mt_user);
      } else {
        handleLoggedOut();
      }
    });
  }

  // 3. Listen for storage changes in real time (e.g. user finished login in another tab)
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

  // 4. Click Handlers
  if (loginBtn) {
    loginBtn.onclick = async () => {
      const sUrl = await getServerUrl();
      chrome.tabs.create({ url: `${sUrl}/login` });
      window.close();
    };
  }

  if (openDashboardBtn) {
    openDashboardBtn.onclick = () => {
      redirectToDashboard();
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
